#!/usr/bin/env bash
set -euo pipefail

# Build one of the Agent implementations supported by the NemoClaw runtime.
# The selected NemoClaw release tag supplies every supported Agent integration.
readonly AGENT_PLATFORM="${NEMOCLAW_AGENT_PLATFORM:-openclaw}"
readonly BUILD_OUTPUT="${NEMOCLAW_BUILD_OUTPUT:-local}"
readonly REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly NEMOCLAW_VERSION="${NEMOCLAW_VERSION:-v0.0.123}"

case "$AGENT_PLATFORM" in
  openclaw)
    readonly NEMOCLAW_BASE_IMAGE="ghcr.io/nvidia/nemoclaw/sandbox-base:${NEMOCLAW_VERSION}"
    readonly NEMOCLAW_IMAGE="${NEMOCLAW_IMAGE:-ghcr.io/tasklattice/tali-nemoclaw-sandbox:dev}"
    readonly DOCKERFILE="Dockerfile"
    readonly DEFAULT_UPSTREAM_IMAGE="tali-nemoclaw-openclaw-upstream:${NEMOCLAW_VERSION#v}"
    readonly WRAPPER_DOCKERFILE="$REPOSITORY_ROOT/infra/docker/Dockerfile.nemoclaw-openclaw"
    ;;
  hermes)
    readonly NEMOCLAW_BASE_IMAGE="ghcr.io/nvidia/nemoclaw/hermes-sandbox-base:${NEMOCLAW_VERSION}"
    readonly NEMOCLAW_IMAGE="${NEMOCLAW_HERMES_IMAGE:-ghcr.io/tasklattice/tali-nemoclaw-hermes-sandbox:dev}"
    readonly DOCKERFILE="agents/hermes/Dockerfile"
    readonly DEFAULT_UPSTREAM_IMAGE="tali-nemoclaw-hermes-upstream:${NEMOCLAW_VERSION#v}"
    readonly WRAPPER_DOCKERFILE="$REPOSITORY_ROOT/infra/docker/Dockerfile.nemoclaw-hermes"
    readonly FALLBACK_BASE_DOCKERFILE="agents/hermes/Dockerfile.base"
    ;;
  deepagents)
    readonly NEMOCLAW_BASE_IMAGE="ghcr.io/nvidia/nemoclaw/langchain-deepagents-code-sandbox-base:${NEMOCLAW_VERSION}"
    readonly NEMOCLAW_IMAGE="${NEMOCLAW_DEEPAGENTS_IMAGE:-ghcr.io/tasklattice/tali-nemoclaw-deepagents-sandbox:dev}"
    readonly DOCKERFILE="agents/langchain-deepagents-code/Dockerfile"
    readonly DEFAULT_UPSTREAM_IMAGE="tali-nemoclaw-deepagents-upstream:${NEMOCLAW_VERSION#v}"
    readonly WRAPPER_DOCKERFILE="$REPOSITORY_ROOT/infra/docker/Dockerfile.nemoclaw-deepagents"
    readonly FALLBACK_BASE_DOCKERFILE="agents/langchain-deepagents-code/Dockerfile.base"
    ;;
  *)
    echo "Unsupported NEMOCLAW_AGENT_PLATFORM: $AGENT_PLATFORM" >&2
    exit 2
    ;;
esac

case "$BUILD_OUTPUT" in
  local)
    if [[ "$NEMOCLAW_IMAGE" != *:dev ]]; then
      echo "Local Sandbox builds must use a :dev final image tag: $NEMOCLAW_IMAGE" >&2
      exit 2
    fi
    readonly UPSTREAM_IMAGE="${NEMOCLAW_UPSTREAM_IMAGE:-$DEFAULT_UPSTREAM_IMAGE}"
    ;;
  ci-push)
    if [[ "${CI:-}" != "true" || "${GITHUB_ACTIONS:-}" != "true" ]]; then
      echo "Release image builds are only supported by the GitHub Actions release workflow." >&2
      exit 2
    fi
    if [[ "${GITHUB_REF_TYPE:-}" != "tag" || ! "${GITHUB_REF_NAME:-}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
      echo "Release image builds require a semantic version tag in GitHub Actions." >&2
      exit 2
    fi
    case "${GITHUB_WORKFLOW_REF:-}" in
      */.github/workflows/release.yml@refs/tags/"${GITHUB_REF_NAME}") ;;
      */.github/workflows/release-control-plane.yml@refs/tags/"${GITHUB_REF_NAME}")
        if [[ ! "$GITHUB_REF_NAME" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-rc\.([1-9][0-9]*)$ ]]; then
          echo "Incremental RC image builds require a canonical vMAJOR.MINOR.PATCH-rc.N tag." >&2
          exit 2
        fi
        ;;
      *)
        echo "Release image builds require an approved tag release workflow." >&2
        exit 2
        ;;
    esac
    if [ -z "${NEMOCLAW_UPSTREAM_IMAGE:-}" ]; then
      echo "NEMOCLAW_UPSTREAM_IMAGE is required when NEMOCLAW_BUILD_OUTPUT=ci-push." >&2
      exit 2
    fi
    if [ -z "${DOCKER_DEFAULT_PLATFORM:-}" ]; then
      echo "DOCKER_DEFAULT_PLATFORM is required when NEMOCLAW_BUILD_OUTPUT=ci-push." >&2
      exit 2
    fi
    release_version="${GITHUB_REF_NAME#v}"
    release_architecture="${DOCKER_DEFAULT_PLATFORM#linux/}"
    if [[ "$NEMOCLAW_IMAGE" != *:"${release_version}-${release_architecture}" ]]; then
      echo "CI release image tag does not match the workflow version and architecture: $NEMOCLAW_IMAGE" >&2
      exit 2
    fi
    readonly UPSTREAM_IMAGE="$NEMOCLAW_UPSTREAM_IMAGE"
    ;;
  *)
    echo "Unsupported NEMOCLAW_BUILD_OUTPUT: $BUILD_OUTPUT" >&2
    exit 2
    ;;
esac

build_image() {
  if [ "$BUILD_OUTPUT" = "ci-push" ]; then
    docker buildx build \
      --platform "$DOCKER_DEFAULT_PLATFORM" \
      --push \
      "$@"
  else
    docker build "$@"
  fi
}

build_context="$(mktemp -d "${TMPDIR:-/tmp}/tali-nemoclaw.XXXXXX")"
trap 'rm -rf "$build_context"' EXIT

node "$REPOSITORY_ROOT/scripts/prepare-nemoclaw-source.mjs" "$build_context" "$NEMOCLAW_VERSION"

if [ "$AGENT_PLATFORM" = "openclaw" ]; then
  node "$REPOSITORY_ROOT/scripts/patch-nemoclaw-openclaw-no-proxy.mjs" \
    "$build_context/scripts/nemoclaw-start.sh"
elif [ "$AGENT_PLATFORM" = "deepagents" ]; then
  node "$REPOSITORY_ROOT/scripts/patch-nemoclaw-deepagents-provider-v2-inference.mjs" \
    "$build_context/agents/langchain-deepagents-code/managed-dcode-runtime.py" \
    "$build_context/agents/langchain-deepagents-code/patch-managed-deepagents-code.py"
fi

resolved_base_image="$NEMOCLAW_BASE_IMAGE"
if [ "$BUILD_OUTPUT" = "ci-push" ]; then
  base_image_available() {
    docker buildx imagetools inspect "$resolved_base_image" >/dev/null 2>&1
  }
else
  base_image_available() {
    docker pull "$resolved_base_image"
  }
fi

if ! base_image_available; then
  if [ "$AGENT_PLATFORM" = "openclaw" ]; then
    echo "Unable to resolve sandbox base image: $resolved_base_image" >&2
    exit 1
  fi

  if [ "$BUILD_OUTPUT" = "ci-push" ]; then
    if [ -z "${NEMOCLAW_FALLBACK_BASE_IMAGE:-}" ]; then
      echo "NEMOCLAW_FALLBACK_BASE_IMAGE is required to publish the $AGENT_PLATFORM base fallback." >&2
      exit 2
    fi
    resolved_base_image="$NEMOCLAW_FALLBACK_BASE_IMAGE"
  else
    if [ "$AGENT_PLATFORM" = "hermes" ]; then
      resolved_base_image="${NEMOCLAW_FALLBACK_BASE_IMAGE:-tali-nemoclaw-hermes-base:${NEMOCLAW_VERSION#v}}"
    else
      resolved_base_image="${NEMOCLAW_FALLBACK_BASE_IMAGE:-tali-nemoclaw-deepagents-base:${NEMOCLAW_VERSION#v}}"
    fi
  fi

  echo "$AGENT_PLATFORM base image is unavailable from GHCR; building the selected-tag fallback."
  build_image \
    --pull \
    --file "$build_context/$FALLBACK_BASE_DOCKERFILE" \
    --tag "$resolved_base_image" \
    "$build_context"
fi

platform_build_args=()
if [ "$AGENT_PLATFORM" = "openclaw" ]; then
  platform_build_args+=(
    --build-arg NEMOCLAW_PRIMARY_MODEL_REF=inference/deepseek-chat
    --build-arg NEMOCLAW_MAX_TOKENS=8192
    --build-arg NEMOCLAW_REASONING=false
  )
else
  platform_build_args+=(
    --build-arg NEMOCLAW_UPSTREAM_PROVIDER=deepseek
  )
fi

build_image \
  --pull \
  --file "$build_context/$DOCKERFILE" \
  --build-arg "BASE_IMAGE=$resolved_base_image" \
  --build-arg NEMOCLAW_MODEL=deepseek-chat \
  --build-arg NEMOCLAW_PROVIDER_KEY=inference \
  --build-arg NEMOCLAW_INFERENCE_BASE_URL=https://inference.local/v1 \
  --build-arg NEMOCLAW_INFERENCE_API=openai-completions \
  --build-arg NEMOCLAW_CONTEXT_WINDOW=65536 \
  --build-arg NEMOCLAW_WEB_SEARCH_ENABLED=0 \
  "${platform_build_args[@]}" \
  --tag "$UPSTREAM_IMAGE" \
  "$build_context"

# Keep the selected upstream Dockerfiles external while ensuring every published
# Agent image crosses a TaskLattice Relay-owned customization boundary.
build_image \
  --file "$WRAPPER_DOCKERFILE" \
  --build-arg "BASE_IMAGE=$UPSTREAM_IMAGE" \
  --tag "$NEMOCLAW_IMAGE" \
  "$REPOSITORY_ROOT"
