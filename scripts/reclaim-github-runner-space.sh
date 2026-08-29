#!/usr/bin/env bash

set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ]]; then
  echo "Refusing to reclaim system directories outside a GitHub-hosted Actions runner." >&2
  exit 2
fi

minimum_free_gib="${MINIMUM_FREE_GIB:-20}"
if [[ ! "$minimum_free_gib" =~ ^[0-9]+$ || "$minimum_free_gib" -lt 1 ]]; then
  echo "MINIMUM_FREE_GIB must be a positive integer; got: $minimum_free_gib" >&2
  exit 2
fi

report_disk_usage() {
  df -h /
  docker system df || true
}

echo "Disk usage before reclaiming GitHub runner space:"
report_disk_usage

# These hosted-runner toolchains are not used by the Helm/Kind smoke test. The
# VM is disposable, so removing them gives containerd enough room to unpack the
# complete default Chart image set without reducing the deployment coverage.
unused_toolchains=(
  /usr/local/lib/android
  /usr/share/dotnet
  /opt/ghc
  /usr/local/share/boost
  /opt/hostedtoolcache/CodeQL
)

for toolchain_path in "${unused_toolchains[@]}"; do
  if [[ -e "$toolchain_path" ]]; then
    sudo du -sh "$toolchain_path" || true
    sudo rm -rf -- "$toolchain_path"
  fi
done

sudo apt-get clean
docker system prune --all --force --volumes

echo "Disk usage after reclaiming GitHub runner space:"
report_disk_usage

available_kib="$(df -Pk / | awk 'NR == 2 { print $4 }')"
required_kib="$((minimum_free_gib * 1024 * 1024))"
if (( available_kib < required_kib )); then
  available_gib="$(awk -v kib="$available_kib" 'BEGIN { printf "%.1f", kib / 1024 / 1024 }')"
  echo "Less than ${minimum_free_gib} GiB is available after cleanup (${available_gib} GiB free)." >&2
  exit 1
fi
