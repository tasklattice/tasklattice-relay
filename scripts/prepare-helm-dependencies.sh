#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
chart_root="$repository_root/charts/tali-relay"
openshell_version="${OPENSHELL_VERSION:-0.0.106}"
agent_sandbox_version="${AGENT_SANDBOX_VERSION:-v1.0.2}"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/tali-helm-dependencies.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

bash "$repository_root/scripts/prepare-agent-sandbox-chart.sh"
helm dependency update --skip-refresh "$chart_root"

# The Relay release never packages or deploys OpenShell. Its Worker config
# points to the separate chart bundled into the shared Control/Worker image.
rendered_chart="$work_dir/tali-relay-rendered.yaml"
helm template tali-relay "$chart_root" \
  --namespace tali \
  --kube-version 1.29.0 \
  > "$rendered_chart"
if grep -Eq '^# Source: tali-relay/charts/openshell/' "$rendered_chart"; then
  echo "The Control release must not deploy its packaged OpenShell dependency." >&2
  exit 1
fi
expected_worker_settings=(
  'chart = "/opt/tali/helm/openshell.tgz"'
  'gatewayImageRepository = "ghcr.io/nvidia/openshell/gateway"'
  "gatewayImageTag = \"${openshell_version}\""
  'supervisorImageRepository = "ghcr.io/nvidia/openshell/supervisor"'
  "supervisorImageTag = \"${openshell_version}\""
)
worker_openshell_settings="$work_dir/worker-openshell.toml"
awk '/^[[:space:]]*\[worker\.project_openshell\]/ { section=1; next }
     section && /^[[:space:]]*\[/ { exit }
     section { sub(/^[[:space:]]+/, ""); print }' "$rendered_chart" > "$worker_openshell_settings"
for expected_setting in "${expected_worker_settings[@]}"; do
  if ! grep -Fxq "$expected_setting" "$worker_openshell_settings"; then
    echo "Worker configuration is missing the packaged OpenShell setting: $expected_setting" >&2
    exit 1
  fi
done
agent_sandbox_image="registry.k8s.io/agent-sandbox/agent-sandbox-controller:${agent_sandbox_version}"
if ! grep -Fq "$agent_sandbox_image" "$rendered_chart"; then
  echo "Control release does not use the declared Agent Sandbox controller: $agent_sandbox_image" >&2
  exit 1
fi


echo "Prepared Relay chart dependencies (Agent Sandbox only). OpenShell is packaged separately for Worker image builds."
