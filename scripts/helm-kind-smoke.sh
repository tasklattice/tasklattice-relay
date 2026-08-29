#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
operation="${1:-install}"
cluster_name="${KIND_CLUSTER_NAME:-tali-ci}"
kube_context="kind-${cluster_name}"
release_name="${HELM_RELEASE_NAME:-tali-relay}"
namespace="${HELM_NAMESPACE:-tali-smoke}"
image_registry="${IMAGE_REGISTRY:-ghcr.io/tasklattice}"
image_tag="${IMAGE_TAG:-latest}"
control_image_tag="${CONTROL_IMAGE_TAG:-$image_tag}"
control_image_pull_policy="${CONTROL_IMAGE_PULL_POLICY:-Always}"
first_party_image_pull_policy="${FIRST_PARTY_IMAGE_PULL_POLICY:-Always}"
helm_timeout="${HELM_TIMEOUT:-30m}"
chart_path="${HELM_CHART_PATH:-$repository_root/charts/tali-relay}"
helm_dependencies_prepared="${HELM_DEPENDENCIES_PREPARED:-false}"

if [[ "$operation" != "install" && "$operation" != "list-images" ]]; then
  echo "Usage: $0 [install|list-images]" >&2
  exit 2
fi

required_commands=(helm)
if [[ "$operation" == "install" ]]; then
  required_commands+=(kind kubectl)
fi

for command_name in "${required_commands[@]}"; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is not installed: $command_name" >&2
    exit 1
  fi
done

if [[ -d "$chart_path" ]]; then
  if [[ "$helm_dependencies_prepared" != "true" ]]; then
    bash "$repository_root/scripts/prepare-helm-dependencies.sh" >&2
  fi
elif [[ ! -f "$chart_path" ]]; then
  echo "Helm chart does not exist: $chart_path" >&2
  exit 1
fi

helm_values=(
  --set-string "global.imageRegistry=$image_registry" \
  --set-string "images.control.tag=$control_image_tag" \
  --set-string "images.control.pullPolicy=$control_image_pull_policy" \
  --set-string "images.runner.tag=$image_tag" \
  --set-string "images.runner.pullPolicy=$first_party_image_pull_policy" \
  --set-string "images.litellm.tag=$image_tag" \
  --set-string "images.litellm.pullPolicy=$first_party_image_pull_policy" \
  --set-string "images.exampleMcp.tag=$image_tag" \
  --set-string "images.exampleMcp.pullPolicy=$first_party_image_pull_policy" \
  --set-string "images.openclawSandbox.tag=$image_tag" \
  --set-string "images.hermesSandbox.tag=$image_tag" \
  --set-string "images.deepagentsSandbox.tag=$image_tag" \
  --set "control.service.type=ClusterIP" \
  --set "litellm.service.type=ClusterIP" \
  --set "openshell.service.type=ClusterIP"
)

if [[ "$operation" == "list-images" ]]; then
  helm template "$release_name" "$chart_path" \
    --namespace "$namespace" \
    --kube-version 1.32.0 \
    "${helm_values[@]}" \
    | sed -nE 's/^[[:space:]]*image:[[:space:]]*"?([^"[:space:]]+)"?[[:space:]]*$/\1/p' \
    | sort -u
  exit 0
fi

if ! kind get clusters | grep -Fxq "$cluster_name"; then
  echo "Kind cluster does not exist: $cluster_name" >&2
  exit 1
fi

if ! kubectl config get-contexts "$kube_context" >/dev/null 2>&1; then
  echo "kubectl context does not exist: $kube_context" >&2
  exit 1
fi

helm upgrade --install "$release_name" "$chart_path" \
  --kube-context "$kube_context" \
  --namespace "$namespace" \
  --create-namespace \
  "${helm_values[@]}" \
  --wait \
  --wait-for-jobs \
  --timeout "$helm_timeout"

kubectl --context "$kube_context" --namespace "$namespace" get pods,services
