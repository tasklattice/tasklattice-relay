#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_PATH:?GITHUB_PATH is required}"
: "${KIND_VERSION:?KIND_VERSION is required}"
: "${KUBECTL_VERSION:?KUBECTL_VERSION is required}"
: "${KIND_NODE_IMAGE:?KIND_NODE_IMAGE is required}"
: "${KIND_CLUSTER_NAME:?KIND_CLUSTER_NAME is required}"

case "$(uname -m)" in
  x86_64) architecture=amd64 ;;
  aarch64|arm64) architecture=arm64 ;;
  *) echo "Unsupported runner architecture" >&2; exit 1 ;;
esac
tools_dir="${RUNNER_TEMP}/tali-kind-tools"
mkdir -p "$tools_dir"

download() {
  curl --fail --location --silent --show-error \
    --retry 5 --retry-all-errors --retry-delay 2 \
    --connect-timeout 15 --max-time 120 \
    --output "$2" "$1"
}
verify() {
  local checksum
  checksum="$(awk '{print $1}' "$2")"
  [[ "$checksum" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "Invalid checksum for $1" >&2; return 1; }
  printf '%s  %s\n' "$checksum" "$1" | sha256sum --check --status
}

kind_asset="https://github.com/kubernetes-sigs/kind/releases/download/${KIND_VERSION}/kind-linux-${architecture}"
download "$kind_asset" "$tools_dir/kind"
download "${kind_asset}.sha256sum" "$tools_dir/kind.sha256"
verify "$tools_dir/kind" "$tools_dir/kind.sha256"
kubectl_asset="https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${architecture}/kubectl"
download "$kubectl_asset" "$tools_dir/kubectl"
download "${kubectl_asset}.sha256" "$tools_dir/kubectl.sha256"
verify "$tools_dir/kubectl" "$tools_dir/kubectl.sha256"
chmod +x "$tools_dir/kind" "$tools_dir/kubectl"
echo "$tools_dir" >> "$GITHUB_PATH"
export PATH="$tools_dir:$PATH"
kind create cluster --name "$KIND_CLUSTER_NAME" --image "$KIND_NODE_IMAGE" --wait 120s
