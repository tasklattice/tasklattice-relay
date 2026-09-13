#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kube_context="${KUBE_CONTEXT:-orbstack}"
namespace="${AGENT_SANDBOX_NAMESPACE:-agent-sandbox-system}"
release_name="${AGENT_SANDBOX_RELEASE:-agent-sandbox}"

for command_name in helm kubectl jq; do
  command -v "$command_name" >/dev/null || { echo "Required command: $command_name" >&2; exit 1; }
done

# This installs one cluster-wide controller, not an isolated second controller
# for a namespace. Refuse to compete with another release's controller.
controllers="$(kubectl --context "$kube_context" get deployments -A -o json)"
if ! jq -e --arg namespace "$namespace" --arg release "$release_name" '
  [.items[] | select(any(.spec.template.spec.containers[];
    .name == "agent-sandbox-controller" or (.image | contains("agent-sandbox-controller")))) |
    select(.metadata.namespace != $namespace or
      .metadata.annotations["meta.helm.sh/release-name"] != $release)] | length == 0
' <<< "$controllers" >/dev/null; then
  echo "Another Agent Sandbox controller already exists. Reuse it with agentSandbox.enabled=false." >&2
  exit 1
fi

if [[ "${HELM_DEPENDENCIES_PREPARED:-false}" != "true" ]]; then
  bash "$repository_root/scripts/prepare-helm-dependencies.sh"
fi
chart="$repository_root/.helm-dependencies/agent-sandbox"
values="$repository_root/charts/tali-relay/examples/agent-sandbox-standalone-values.yaml"

# Helm does not update CRDs on upgrade. Only fresh/v1beta1 installations are
# supported here; legacy API storage migration belongs to the cluster owner.
for crd in sandboxes.agents.x-k8s.io sandboxclaims.extensions.agents.x-k8s.io \
  sandboxtemplates.extensions.agents.x-k8s.io sandboxwarmpools.extensions.agents.x-k8s.io; do
  existing="$(kubectl --context "$kube_context" get crd "$crd" --ignore-not-found -o json)"
  if [[ -n "$existing" ]] && ! jq -e '
    all(.status.storedVersions[]; . == "v1beta1") and
    all(.spec.versions[]; .name == "v1beta1")
  ' <<< "$existing" >/dev/null; then
    echo "$crd still contains legacy API versions; use a fresh test cluster or the upstream migration guide." >&2
    exit 1
  fi
done
kubectl --context "$kube_context" apply --server-side --field-manager=tali-agent-sandbox-crds -f "$chart/crds/"
helm upgrade --install "$release_name" "$chart" \
  --kube-context "$kube_context" --namespace "$namespace" --create-namespace \
  --values "$values" --skip-crds --wait --timeout 5m
kubectl --context "$kube_context" --namespace "$namespace" \
  rollout status deployment/agent-sandbox-controller --timeout=60s
echo "Agent Sandbox v1.0.2 installed. Use AGENT_SANDBOX_ENABLED=false for the Relay local deployment."
