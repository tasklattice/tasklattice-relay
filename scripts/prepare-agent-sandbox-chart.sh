#!/usr/bin/env bash
set -euo pipefail

for command_name in awk curl helm tar; do
  command -v "$command_name" >/dev/null || { echo "Required command: $command_name" >&2; exit 1; }
done

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${AGENT_SANDBOX_VERSION:-v1.0.2}"
chart_version="${AGENT_SANDBOX_CHART_VERSION:-0.1.0}"
chart="$repository_root/.helm-dependencies/agent-sandbox"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/tali-agent-sandbox-chart.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

curl -fsSL --retry 3 \
  "https://github.com/kubernetes-sigs/agent-sandbox/archive/refs/tags/${version}.tar.gz" \
  -o "$work_dir/source.tar.gz"
tar -xzf "$work_dir/source.tar.gz" -C "$work_dir"
source="$work_dir/agent-sandbox-${version#v}"
actual_version="$(helm show chart "$source/helm" | awk '/^version:/ {print $2}')"
if [[ "$actual_version" != "$chart_version" ]]; then
  echo "Unexpected Agent Sandbox chart version: $actual_version" >&2
  exit 1
fi
mkdir -p "$(dirname "$chart")"
rm -rf "$chart"
cp -R "$source/helm" "$chart"
cp "$source/LICENSE" "$chart/LICENSE"
echo "Prepared Agent Sandbox ${version} (chart ${chart_version})."
