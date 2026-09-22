#!/usr/bin/env bash
set -euo pipefail

for command_name in helm patch tar; do
  command -v "$command_name" >/dev/null || { echo "Required command: $command_name" >&2; exit 1; }
done

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${OPENSHELL_VERSION:-0.0.106}"
chart="$repository_root/.helm-dependencies/openshell"
output="$repository_root/dist/worker-charts"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/tali-worker-charts.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

helm pull oci://ghcr.io/nvidia/openshell/helm-chart \
  --version "$version" --destination "$work_dir"
tar -xzf "$work_dir/helm-chart-${version}.tgz" -C "$work_dir"
mv "$work_dir/helm-chart" "$work_dir/openshell"
patch --directory "$work_dir" --strip 1 < "$repository_root/charts/tali-relay/patches/openshell.patch"
find "$work_dir/openshell" -type f \( -name "*.orig" -o -name "*.rej" \) -delete
helm lint "$work_dir/openshell"
helm package "$work_dir/openshell" --destination "$work_dir/packaged" >/dev/null
package="$work_dir/packaged/openshell-${version}.tgz"

helm template openshell "$package" \
  --namespace project-worker-chart-validation --kube-version 1.29.0 \
  --set server.disableTls=true --set supervisor.sideloadMethod=init-container \
  --set pkiInitJob.activeDeadlineSeconds=420 \
  --set-string "supervisor.image.tag=$version" > "$work_dir/rendered.yaml"
for image in "ghcr.io/nvidia/openshell/gateway:$version" "ghcr.io/nvidia/openshell/supervisor:$version"; do
  if ! grep -Fq "$image" "$work_dir/rendered.yaml"; then
    echo "Worker chart is missing its declared image: $image" >&2
    exit 1
  fi
done

if ! grep -Eq '^[[:space:]]+activeDeadlineSeconds: 420$' "$work_dir/rendered.yaml"; then
  echo "Worker chart does not honor the configurable certgen deadline." >&2
  exit 1
fi

# Keep an unpacked copy for the Project ownership and live integration tests.
mkdir -p "$(dirname "$chart")" "$output"
rm -rf "$chart"
cp -R "$work_dir/openshell" "$chart"
cp "$package" "$output/openshell.tgz"
echo "Packaged Worker OpenShell ${version}: $output/openshell.tgz"
