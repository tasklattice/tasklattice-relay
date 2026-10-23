#!/usr/bin/env bash

# Shared authenticated Control API helpers for local deployment configuration.
# The caller owns control_origin and cookie_file so multiple scripts can reuse
# the same behavior without persisting a development credential on disk.

dev_control_api_request() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"
  local response
  local request_args=(
    --silent
    --show-error
    --fail-with-body
    --connect-timeout 10
    --max-time "${CONTROL_API_TIMEOUT_SECONDS:-600}"
    --cookie "$cookie_file"
    --header "origin: $control_origin"
    --header "content-type: application/json"
    --request "$method"
  )

  if [[ -n "$payload" ]]; then
    request_args+=(--data "$payload")
  fi

  if ! response="$(curl "${request_args[@]}" "$control_origin$path")"; then
    local detail
    detail="$(jq -r '.detail // .message // .error // empty' <<<"$response" 2>/dev/null || true)"
    echo "Control API request failed: $method $path${detail:+: $detail}" >&2
    return 1
  fi

  printf '%s' "$response"
}

dev_control_login() {
  local username="${CONTROL_LOCAL_ADMIN_USERNAME:-admin}"
  local configured_password="${CONTROL_LOCAL_ADMIN_PASSWORD:-}"
  if [[ -z "$configured_password" ]]; then
    local bootstrap_namespace="${HELM_NAMESPACE:-tali}"
    local bootstrap_release="${HELM_RELEASE_NAME:-tali-relay}"
    local kube_args=(-n "$bootstrap_namespace")
    [[ -z "${KUBE_CONTEXT:-}" ]] || kube_args+=(--context "$KUBE_CONTEXT")
    if ! configured_password="$(kubectl "${kube_args[@]}" get secrets \
      -l "app.kubernetes.io/instance=$bootstrap_release,app.kubernetes.io/managed-by=tali-relay-bootstrap" -o json \
      | jq -er '[.items[] | .data.initialPlatformAdministratorPassword // empty] | if length==1 then .[0] else error("expected one bootstrap credential store") end' \
      | base64 --decode)" || [[ -z "$configured_password" ]]; then
      echo "Cannot read the generated administrator credential. Set CONTROL_LOCAL_ADMIN_PASSWORD for external/custom accounts." >&2
      return 1
    fi
  fi
  local password_candidates=("$configured_password")
  local response=""

  local candidate
  for candidate in "${password_candidates[@]}"; do
    local login_payload
    login_payload="$({
      printf '%s' "$candidate" | jq --raw-input --slurp \
        --arg username "$username" \
        '{username: $username, password: .}'
    })"
    if response="$(
      printf '%s' "$login_payload" | curl \
        --silent \
        --show-error \
        --fail-with-body \
        --connect-timeout 10 \
        --max-time 30 \
        --cookie-jar "$cookie_file" \
        --header "origin: $control_origin" \
        --header "content-type: application/json" \
        --request POST \
        --data-binary @- \
        "$control_origin/api/auth/sign-in/username"
    )"; then
      return 0
    fi
  done

  local detail
  detail="$(jq -r '.detail // .message // .error // empty' <<<"$response" 2>/dev/null || true)"
  echo "Unable to sign in to Control with the local administrator${detail:+: $detail}" >&2
  echo "Set CONTROL_LOCAL_ADMIN_USERNAME and CONTROL_LOCAL_ADMIN_PASSWORD if the development credentials changed." >&2
  return 1
}
