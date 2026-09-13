#!/usr/bin/env bash
# Exercise the same OpenShell CLI -> Gateway -> Sandbox API path as Relay.
# Requires the controller and the local Relay runner image; creates and removes
# its own test namespace. It does not install or change the controller.
set -euo pipefail
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kube_context="${KUBE_CONTEXT:-orbstack}"
namespace="tali-sandbox-compat-$(date +%s)-$RANDOM"
runner_image="${RUNNER_IMAGE:-ghcr.io/tasklattice/tali-openshell-runner:dev}"
release_name="$namespace"
sandbox_name=compat-v102
resource_name=default--compat-v102
workspace_name=workspace-default--compat-v102
k() { kubectl --context "$kube_context" --namespace "$namespace" "$@"; }
cli() {
  k exec openshell-client -- openshell \
    --gateway-endpoint "http://${release_name}-openshell:8080" "$@"
}

for command_name in helm kubectl jq; do
  command -v "$command_name" >/dev/null || { echo "Required command: $command_name" >&2; exit 1; }
done
kubectl --context "$kube_context" get crd sandboxes.agents.x-k8s.io -o json |
  jq -e '[.spec.versions[] | select(.served) | .name] == ["v1beta1"]' >/dev/null
kubectl --context "$kube_context" create namespace "$namespace"
cleanup() {
  result=$?
  if (( result != 0 )); then k get sandboxes,pods,pvc || true; fi
  helm --kube-context "$kube_context" --namespace "$namespace" uninstall "$release_name" >/dev/null 2>&1 || true
  kubectl --context "$kube_context" delete namespace "$namespace" --wait=false >/dev/null
  exit "$result"
}
trap cleanup EXIT

helm upgrade --install "$release_name" "$repository_root/.helm-dependencies/openshell" \
  --kube-context "$kube_context" --namespace "$namespace" \
  --set image.tag=0.0.106 --set supervisor.image.tag=0.0.106 \
  --set supervisor.sideloadMethod=init-container \
  --set server.disableTls=true --set server.auth.allowUnauthenticatedUsers=true \
  --set server.telemetryEnabled=false --set server.sandboxImagePullPolicy=IfNotPresent \
  --set server.workspaceDefaultStorageSize=1Gi --set service.type=ClusterIP \
  --wait --timeout 5m
k run openshell-client --image="$runner_image" --image-pull-policy=IfNotPresent \
  --restart=Never --command -- sleep 1800
k wait pod/openshell-client --for=condition=Ready --timeout=120s
[[ "$(k exec openshell-client -- openshell --version)" == "openshell 0.0.106" ]]
# Endpoint publication can briefly lag behind Pod readiness.
for attempt in {1..15}; do
  if cli sandbox list -o json >/dev/null 2>&1; then break; fi
  if (( attempt == 15 )); then echo "Gateway did not become reachable" >&2; exit 1; fi
  sleep 2
done
cli sandbox create --name "$sandbox_name" \
  --from ghcr.io/nvidia/nemoclaw/sandbox-base:v0.0.123 --cpu 500m --memory 1Gi \
  --no-tty --no-auto-providers -- sh -c 'echo agent-sandbox-v1.0.2 > /sandbox/compat-marker'
k wait sandbox/"$resource_name" --for=condition=Ready --timeout=120s
k get sandbox "$resource_name" -o json | jq -e '
  .apiVersion == "agents.x-k8s.io/v1beta1" and .spec.operatingMode == "Running" and
  .metadata.annotations["agents.x-k8s.io/pod-name"] == null
' >/dev/null
pod_uid="$(k get pod "$resource_name" -o jsonpath='{.metadata.uid}')"
pvc_uid="$(k get pvc "$workspace_name" -o jsonpath='{.metadata.uid}')"
cli sandbox stop "$sandbox_name"
k wait sandbox/"$resource_name" --for=condition=Suspended --timeout=120s
k wait pod/"$resource_name" --for=delete --timeout=120s
[[ "$(k get pvc "$workspace_name" -o jsonpath='{.metadata.uid}')" == "$pvc_uid" ]]
cli sandbox start "$sandbox_name"
k wait sandbox/"$resource_name" --for=condition=Ready --timeout=120s
[[ "$(k get pod "$resource_name" -o jsonpath='{.metadata.uid}')" != "$pod_uid" ]]
[[ "$(k get pvc "$workspace_name" -o jsonpath='{.metadata.uid}')" == "$pvc_uid" ]]
[[ "$(cli sandbox exec --name "$sandbox_name" --timeout 30 -- cat /sandbox/compat-marker)" == "agent-sandbox-v1.0.2" ]]
cli sandbox delete "$sandbox_name"
k wait --for=delete sandbox/"$resource_name" pod/"$resource_name" pvc/"$workspace_name" --timeout=120s
echo "PASS: OpenShell 0.0.106 + Agent Sandbox v1beta1: create, exec, suspend, resume, persistent workspace, delete."
