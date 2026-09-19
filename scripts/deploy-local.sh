#!/usr/bin/env bash
set -euo pipefail

action="${1:-deploy}"
if (( $# > 0 )); then
  shift
fi
enable_keycloak=false
enable_example_mcp=false
release_name="${HELM_RELEASE_NAME:-tali-relay}"
namespace="${HELM_NAMESPACE:-tali}"
helm_timeout="${HELM_TIMEOUT:-30m}"
image_registry="ghcr.io/tasklattice"
image_tag="dev"
control_service_port="${CONTROL_SERVICE_PORT:-38080}"
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$action" in
  deploy | delete) ;;
  *)
    echo "usage: $0 [deploy|delete] [--keycloak] [--example-mcp]" >&2
    exit 2
    ;;
esac

while (( $# > 0 )); do
  case "$1" in
    --keycloak)
      enable_keycloak=true
      ;;
    --example-mcp)
      enable_example_mcp=true
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "usage: $0 [deploy|delete] [--keycloak] [--example-mcp]" >&2
      exit 2
      ;;
  esac
  shift
done

required_commands=(helm jq kubectl)
if [[ "$action" == "deploy" ]]; then
  required_commands+=(docker)
fi
for command_name in "${required_commands[@]}"; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is not installed: $command_name" >&2
    exit 1
  fi
done

if [[ -n "${KUBE_CONTEXT:-}" ]]; then
  kube_context="$KUBE_CONTEXT"
elif kube_context="$(kubectl config current-context 2>/dev/null)" && [[ -n "$kube_context" ]]; then
  :
elif kubectl config get-contexts orbstack >/dev/null 2>&1; then
  kube_context="orbstack"
else
  echo "No Kubernetes context is selected. Set KUBE_CONTEXT explicitly." >&2
  exit 1
fi

if ! kubectl config get-contexts "$kube_context" >/dev/null 2>&1; then
  echo "Kubernetes context does not exist: $kube_context" >&2
  exit 1
fi

if ! kubectl --context "$kube_context" version --request-timeout=10s >/dev/null 2>&1; then
  echo "Kubernetes cluster is not reachable through context: $kube_context" >&2
  exit 1
fi

if [[ "$action" == "delete" ]]; then
  if helm --kube-context "$kube_context" --namespace "$namespace" status "$release_name" >/dev/null 2>&1; then
    helm --kube-context "$kube_context" --namespace "$namespace" uninstall "$release_name"
    kubectl --context "$kube_context" --namespace "$namespace" delete secret \
      "$release_name-example-mcp-github" --ignore-not-found >/dev/null
  else
    echo "Helm release does not exist: $namespace/$release_name"
  fi
  exit 0
fi

# A separately installed controller is selected explicitly; do not infer
# controller ownership from CRD presence alone.
agent_sandbox_enabled="${AGENT_SANDBOX_ENABLED:-true}"
if [[ "$agent_sandbox_enabled" != "true" && "$agent_sandbox_enabled" != "false" ]]; then
  echo "AGENT_SANDBOX_ENABLED must be true or false." >&2
  exit 1
fi
agent_sandbox_helm_args=(--set "agentSandbox.enabled=$agent_sandbox_enabled")
crd_helm_args=()
if [[ "$agent_sandbox_enabled" == "false" ]]; then
  kubectl --context "$kube_context" get crd sandboxes.agents.x-k8s.io -o json |
    jq -e 'any(.spec.versions[]; .name == "v1beta1" and .served)' >/dev/null || {
      echo "The external controller requires the Agent Sandbox v1beta1 CRD." >&2
      exit 1
    }
  crd_helm_args+=(--skip-crds)
else
  kubectl --context "$kube_context" get deployments -A -o json |
    jq -e --arg namespace "$namespace" --arg release "$release_name" '
      [.items[] | select(any(.spec.template.spec.containers[];
        .name == "agent-sandbox-controller" or (.image | contains("agent-sandbox-controller")))) |
        select(.metadata.namespace != $namespace or
          .metadata.annotations["meta.helm.sh/release-name"] != $release)] | length == 0
    ' >/dev/null || {
      echo "Another Agent Sandbox controller exists; set AGENT_SANDBOX_ENABLED=false to reuse it." >&2
      exit 1
    }
fi

# Helm 4 uses server-side apply and can encounter a managed-fields conflict
# when an existing local release updates a rendered checksum annotation. The
# local deployment owns these resources, so let Helm reclaim its own fields.
helm_conflict_args=()
if helm upgrade --help | grep -q -- "--force-conflicts"; then
  helm_conflict_args+=(--force-conflicts)
fi

images=(
  "$image_registry/tali-control:$image_tag"
  "$image_registry/tali-openshell-runner:$image_tag"
  "$image_registry/tali-expert-agent-runtime:$image_tag"
  "$image_registry/tali-litellm:$image_tag"
  "$image_registry/demo-test:$image_tag"
  "$image_registry/tali-nemoclaw-hermes-sandbox:$image_tag"
)
missing_images=()
for image_name in "${images[@]}"; do
  if ! docker image inspect "$image_name" >/dev/null 2>&1; then
    missing_images+=("$image_name")
  fi
done
if (( ${#missing_images[@]} > 0 )); then
  echo "Build all local development images before deploying:" >&2
  printf '  %s\n' "${missing_images[@]}" >&2
  echo "Run: npm run images:build:dev" >&2
  exit 1
fi

if [[ "$kube_context" == kind-* ]]; then
  if ! command -v kind >/dev/null 2>&1; then
    echo "The kind CLI is required to load local images into $kube_context." >&2
    exit 1
  fi
  kind load docker-image --name "${kube_context#kind-}" "${images[@]}"
fi

rollout_revision="dev-$(date -u +%Y%m%d%H%M%S)"
control_public_url="${CONTROL_PUBLIC_URL:-http://localhost:${control_service_port}}"
keycloak_helm_args=()
if [[ "$enable_keycloak" == "true" ]]; then
  keycloak_service_port="${KEYCLOAK_SERVICE_PORT:-8180}"
  if [[ "$kube_context" == "orbstack" ]]; then
    node_ip="$(
      kubectl --context "$kube_context" get nodes -o json |
        jq -r '
          [
            .items[0].status.addresses[]
            | select(.type == "InternalIP")
            | .address
            | select(test("^[0-9]+(\\.[0-9]+){3}$"))
          ][0] // empty
        '
    )"
    if [[ -z "$node_ip" ]]; then
      echo "Unable to find an IPv4 InternalIP for the OrbStack Kubernetes node." >&2
      exit 1
    fi
    keycloak_public_url="${KEYCLOAK_PUBLIC_URL:-http://keycloak.localhost:${keycloak_service_port}}"
    keycloak_helm_args+=(
      --set-string "control.hostAliases[0].ip=$node_ip"
      --set-string "control.hostAliases[0].hostnames[0]=keycloak.localhost"
    )
  else
    control_public_url="${CONTROL_PUBLIC_URL:-}"
    keycloak_public_url="${KEYCLOAK_PUBLIC_URL:-}"
    if [[ -z "$control_public_url" || -z "$keycloak_public_url" ]]; then
      echo "CONTROL_PUBLIC_URL and KEYCLOAK_PUBLIC_URL are required with --keycloak outside OrbStack." >&2
      exit 1
    fi
  fi
  keycloak_helm_args+=(
    --set keycloak.enabled=true
    --set-string "keycloak.publicUrl=$keycloak_public_url"
    --set "keycloak.service.port=$keycloak_service_port"
  )
fi

control_helm_args=(--set-string "control.publicUrls[0]=$control_public_url")

example_mcp_helm_args=()
if [[ "$enable_example_mcp" == "true" ]]; then
  example_mcp_helm_args+=(--set exampleMcp.enabled=true)
  github_token="${GITHUB_TOKEN:-}"
  if [[ -z "$github_token" ]] && command -v gh >/dev/null 2>&1; then
    github_token="$(gh auth token 2>/dev/null || true)"
  fi
  if [[ -n "$github_token" ]]; then
    example_mcp_github_secret="$release_name-example-mcp-github"
    kubectl --context "$kube_context" create namespace "$namespace" \
      --dry-run=client --output=yaml | kubectl --context "$kube_context" apply -f - >/dev/null
    kubectl --context "$kube_context" --namespace "$namespace" create secret generic \
      "$example_mcp_github_secret" --from-literal=GITHUB_TOKEN="$github_token" \
      --dry-run=client --output=yaml | kubectl --context "$kube_context" apply -f - >/dev/null
    example_mcp_helm_args+=(
      --set-string "exampleMcp.githubTokenSecret.name=$example_mcp_github_secret"
    )
    echo "Configured the example MCP GitHub tool with a Secret-backed local credential."
  else
    echo "No GITHUB_TOKEN or authenticated gh CLI was found; GitHub API rate limits may block the example MCP tool." >&2
  fi
fi

bash "$repository_root/scripts/prepare-helm-dependencies.sh"
if [[ "$agent_sandbox_enabled" == "true" ]]; then
  for crd_file in "$repository_root"/.helm-dependencies/agent-sandbox/crds/*.yaml; do
    crd_name="$(kubectl --context "$kube_context" create --dry-run=client -f "$crd_file" -o jsonpath='{.metadata.name}')"
    existing_crd="$(kubectl --context "$kube_context" get crd "$crd_name" --ignore-not-found -o json)"
    if [[ -n "$existing_crd" ]] && ! jq -e '
      all(.status.storedVersions[]; . == "v1beta1") and
      all(.spec.versions[]; .name == "v1beta1")
    ' <<< "$existing_crd" >/dev/null; then
      echo "$crd_name contains legacy APIs; use a fresh test cluster or the upstream migration guide." >&2
      exit 1
    fi
  done
  # Helm skips CRD updates, so install the pinned v1beta1 schemas explicitly.
  kubectl --context "$kube_context" apply --server-side --field-manager=tali-agent-sandbox-crds \
    -f "$repository_root/.helm-dependencies/agent-sandbox/crds/"
  crd_helm_args+=(--skip-crds)
fi
helm lint "$repository_root/charts/tali-relay" \
  --values "$repository_root/charts/tali-relay/values-dev.yaml" \
  "${agent_sandbox_helm_args[@]}" \
  ${control_helm_args[@]+"${control_helm_args[@]}"} \
  ${keycloak_helm_args[@]+"${keycloak_helm_args[@]}"} \
  ${example_mcp_helm_args[@]+"${example_mcp_helm_args[@]}"}
helm upgrade --install "$release_name" "$repository_root/charts/tali-relay" \
  --kube-context "$kube_context" \
  --namespace "$namespace" \
  --create-namespace \
  --values "$repository_root/charts/tali-relay/values-dev.yaml" \
  --set-string "global.rolloutRevision=$rollout_revision" \
  --set "control.service.port=$control_service_port" \
  "${agent_sandbox_helm_args[@]}" \
  ${control_helm_args[@]+"${control_helm_args[@]}"} \
  ${keycloak_helm_args[@]+"${keycloak_helm_args[@]}"} \
  ${example_mcp_helm_args[@]+"${example_mcp_helm_args[@]}"} \
  ${crd_helm_args[@]+"${crd_helm_args[@]}"} \
  ${helm_conflict_args[@]+"${helm_conflict_args[@]}"} \
  --wait \
  --wait-for-jobs \
  --timeout "$helm_timeout"

docling_selector="app.kubernetes.io/instance=$release_name,app.kubernetes.io/component=docling"
docling_deployments="$(
  kubectl --context "$kube_context" --namespace "$namespace" \
    get deployment --selector "$docling_selector" --output name
)"
if [[ -z "$docling_deployments" ]]; then
  echo "The local release did not create the required Docling Deployment." >&2
  exit 1
fi
kubectl --context "$kube_context" --namespace "$namespace" \
  rollout status deployment --selector "$docling_selector" --timeout "$helm_timeout"
kubectl --context "$kube_context" --namespace "$namespace" \
  get deployment,service,pvc --selector "$docling_selector"

case "${CONTROL_DEVELOPMENT_PROJECTS_ENABLED:-true}" in
  true)
    CONTROL_PUBLIC_URL="$control_public_url" \
      bash "$repository_root/scripts/configure-dev-projects.sh"
    ;;
  false)
    echo "Skipping development isolation Project configuration."
    ;;
  *)
    echo "CONTROL_DEVELOPMENT_PROJECTS_ENABLED must be true or false." >&2
    exit 2
    ;;
esac

if [[ "$enable_keycloak" == "true" ]]; then
  CONTROL_PUBLIC_URL="$control_public_url" \
    KEYCLOAK_PUBLIC_URL="$keycloak_public_url" \
    KUBE_CONTEXT="$kube_context" \
    HELM_NAMESPACE="$namespace" \
    HELM_RELEASE_NAME="$release_name" \
    bash "$repository_root/scripts/configure-dev-keycloak-sso.sh"
fi

kubectl --context "$kube_context" --namespace "$namespace" get pods,services,pvc
helm --kube-context "$kube_context" --namespace "$namespace" status "$release_name"
