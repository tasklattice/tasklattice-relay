#!/usr/bin/env bash
set -euo pipefail

required_commands=(cp helm sed)
for command_name in "${required_commands[@]}"; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is not installed: $command_name" >&2
    exit 1
  fi
done

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${1:-0.0.0-dev}"
image_registry="${TALI_IMAGE_REGISTRY:-ghcr.io/tasklattice}"
chart_root="$repository_root/charts/tali-relay"
output_root="$repository_root/dist/control-plane-chart"

if [[ "$version" != "0.0.0-dev" ]]; then
  if [[ "${CI:-}" != "true" || "${GITHUB_ACTIONS:-}" != "true" ]]; then
    echo "Release chart builds are only supported by the GitHub Actions release workflow." >&2
    exit 2
  fi
  if [[ "${GITHUB_REF_TYPE:-}" != "tag" || ! "${GITHUB_REF_NAME:-}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "Release chart builds require a semantic version tag in GitHub Actions." >&2
    exit 2
  fi
  case "${GITHUB_WORKFLOW_REF:-}" in
    */.github/workflows/release.yml@refs/tags/"${GITHUB_REF_NAME}")
      if [[ "${GITHUB_REF_NAME}" == *-rc.* ]]; then
        echo "RC tags must use release-control-plane.yml." >&2
        exit 2
      fi
      ;;
    */.github/workflows/release-control-plane.yml@refs/tags/"${GITHUB_REF_NAME}")
      node "$repository_root/scripts/control-plane-release.mjs" metadata "$GITHUB_REF_NAME" >/dev/null
      ;;
    *)
      echo "Release chart builds require an approved tag release workflow." >&2
      exit 2
      ;;
  esac
  if [[ "${GITHUB_REF_NAME#v}" != "$version" ]]; then
    echo "Release chart version does not match the workflow tag: $version" >&2
    exit 2
  fi
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/tali-control-chart.XXXXXX")"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

bash "$repository_root/scripts/prepare-helm-dependencies.sh"
cp -R "$chart_root" "$work_dir/tali-relay"
sed -i.bak \
  "s|imageRegistry: ghcr.io/tasklattice|imageRegistry: ${image_registry}|" \
  "$work_dir/tali-relay/values.yaml"
rm -f "$work_dir/tali-relay/values.yaml.bak"

if [[ "${GITHUB_WORKFLOW_REF:-}" == */.github/workflows/release-control-plane.yml@refs/tags/"${GITHUB_REF_NAME:-}" ]]; then
  node "$repository_root/scripts/control-plane-release.mjs" pin-values "$GITHUB_REF_NAME" \
    "$work_dir/tali-relay/values.yaml" "$image_registry"
fi

mkdir -p "$output_root"
helm lint "$work_dir/tali-relay"
helm package "$work_dir/tali-relay" \
  --version "$version" \
  --app-version "$version" \
  --destination "$work_dir/packaged" >/dev/null
cp "$work_dir/packaged/tali-relay-${version}.tgz" "$output_root/tali-relay.tgz"

echo "Packaged complete TaskLattice Relay Helm chart at $output_root/tali-relay.tgz"
