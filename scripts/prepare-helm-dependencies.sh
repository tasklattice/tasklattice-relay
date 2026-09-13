#!/usr/bin/env bash
set -euo pipefail

required_commands=(awk curl find grep helm patch tar)
for command_name in "${required_commands[@]}"; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is not installed: $command_name" >&2
    exit 1
  fi
done

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
chart_root="$repository_root/charts/tali-relay"
dependency_source_root="$repository_root/.helm-dependencies"
openshell_version="${OPENSHELL_VERSION:-0.0.106}"
openshell_upstream_reference="oci://ghcr.io/nvidia/openshell/helm-chart"
patch_file="$chart_root/patches/openshell.patch"
openshell_chart="$dependency_source_root/openshell"
agent_sandbox_version="${AGENT_SANDBOX_VERSION:-v1.0.2}"
agent_sandbox_chart_version="${AGENT_SANDBOX_CHART_VERSION:-0.1.0}"
agent_sandbox_source_directory="agent-sandbox-${agent_sandbox_version#v}"
agent_sandbox_url="https://github.com/kubernetes-sigs/agent-sandbox/archive/refs/tags/${agent_sandbox_version}.tar.gz"
agent_sandbox_chart="$dependency_source_root/agent-sandbox"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/tali-helm-dependencies.XXXXXX")"
openshell_download_directory="$work_dir/openshell-download"
openshell_archive="$openshell_download_directory/helm-chart-${openshell_version}.tgz"
agent_sandbox_archive="$work_dir/agent-sandbox-${agent_sandbox_version}.tar.gz"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

mkdir -p "$dependency_source_root" "$openshell_download_directory"
helm pull "$openshell_upstream_reference" \
  --version "$openshell_version" \
  --destination "$openshell_download_directory"
curl -fsSL "$agent_sandbox_url" -o "$agent_sandbox_archive"

tar -xzf "$agent_sandbox_archive" -C "$work_dir"
rm -rf "$agent_sandbox_chart"
cp -R "$work_dir/$agent_sandbox_source_directory/helm" "$agent_sandbox_chart"
cp "$work_dir/$agent_sandbox_source_directory/LICENSE" "$agent_sandbox_chart/LICENSE"
actual_agent_sandbox_chart_version="$(helm show chart "$agent_sandbox_chart" | awk '/^version:/ {print $2}')"
if [[ "$actual_agent_sandbox_chart_version" != "$agent_sandbox_chart_version" ]]; then
  echo "Unexpected Agent Sandbox chart version: $actual_agent_sandbox_chart_version" >&2
  exit 1
fi
find "$agent_sandbox_chart" -type f \
  \( -name "*.orig" -o -name "*.rej" \) -delete

tar -xzf "$openshell_archive" -C "$work_dir"
mv "$work_dir/helm-chart" "$work_dir/openshell"
patch --directory "$work_dir" --strip 1 < "$patch_file"
rm -rf "$openshell_chart"
cp -R "$work_dir/openshell" "$openshell_chart"
find "$openshell_chart" -type f \
  \( -name "*.orig" -o -name "*.rej" \) -delete

helm dependency update --skip-refresh "$chart_root"

packaged_openshell_chart="$chart_root/charts/openshell-${openshell_version}.tgz"
if [[ ! -f "$packaged_openshell_chart" ]]; then
  echo "Expected packaged OpenShell dependency was not created: $packaged_openshell_chart" >&2
  exit 1
fi

rendered_chart="$work_dir/tali-relay-rendered.yaml"
helm template tali-relay "$chart_root" \
  --namespace tali \
  --kube-version 1.29.0 \
  > "$rendered_chart"
expected_images=(
  "ghcr.io/nvidia/openshell/gateway:${openshell_version}"
  "ghcr.io/nvidia/openshell/supervisor:${openshell_version}"
  "registry.k8s.io/agent-sandbox/agent-sandbox-controller:${agent_sandbox_version}"
)
for expected_image in "${expected_images[@]}"; do
  if ! grep -Fq "$expected_image" "$rendered_chart"; then
    echo "Rendered Chart does not use the declared dependency image: $expected_image" >&2
    exit 1
  fi
done

echo "Prepared OpenShell ${openshell_version} and Agent Sandbox ${agent_sandbox_version} (chart ${agent_sandbox_chart_version}) from their selected upstream tags."
