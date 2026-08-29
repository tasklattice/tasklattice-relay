#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cluster_name="${KIND_CLUSTER_NAME:-tali-ci}"
kind_node="${cluster_name}-control-plane"
max_attempts="${IMAGE_PULL_ATTEMPTS:-3}"
minimum_free_gib="${MINIMUM_KIND_FREE_GIB:-3}"

for command_name in docker helm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is not installed: $command_name" >&2
    exit 1
  fi
done

if [[ ! "$max_attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "IMAGE_PULL_ATTEMPTS must be a positive integer; got: $max_attempts" >&2
  exit 2
fi

if [[ ! "$minimum_free_gib" =~ ^[0-9]+$ || "$minimum_free_gib" -lt 1 ]]; then
  echo "MINIMUM_KIND_FREE_GIB must be a positive integer; got: $minimum_free_gib" >&2
  exit 2
fi

if ! docker container inspect "$kind_node" >/dev/null 2>&1; then
  echo "Kind control-plane container does not exist: $kind_node" >&2
  exit 1
fi

skip_image() {
  local candidate="$1"
  local skipped_image

  while IFS= read -r skipped_image; do
    if [[ -n "$skipped_image" && "$candidate" == "$skipped_image" ]]; then
      return 0
    fi
  done <<< "${SKIP_IMAGES:-}"

  return 1
}

pull_image() {
  local image="$1"
  local attempt

  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    echo "Preloading $image into $kind_node (attempt $attempt/$max_attempts)"
    if docker exec "$kind_node" crictl pull "$image"; then
      return 0
    fi

    docker exec "$kind_node" df -h /var/lib/containerd || true
    if (( attempt < max_attempts )); then
      sleep 5
    fi
  done

  echo "Unable to preload image after $max_attempts attempts: $image" >&2
  return 1
}

images=()
while IFS= read -r image; do
  [[ -n "$image" ]] && images+=("$image")
done < <(bash "$repository_root/scripts/helm-kind-smoke.sh" list-images)

if (( ${#images[@]} == 0 )); then
  echo "The rendered Helm Chart did not contain any workload images." >&2
  exit 1
fi

for image in "${images[@]}"; do
  if skip_image "$image"; then
    echo "Already loaded local image: $image"
    continue
  fi
  pull_image "$image"
done

echo "Images available to the Kind node:"
docker exec "$kind_node" crictl images
docker exec "$kind_node" df -h /var/lib/containerd

available_kib="$(docker exec "$kind_node" df -Pk /var/lib/containerd | awk 'NR == 2 { print $4 }')"
required_kib="$((minimum_free_gib * 1024 * 1024))"
if (( available_kib < required_kib )); then
  available_gib="$(awk -v kib="$available_kib" 'BEGIN { printf "%.1f", kib / 1024 / 1024 }')"
  echo "Less than ${minimum_free_gib} GiB remains for the deployed workloads (${available_gib} GiB free)." >&2
  exit 1
fi
