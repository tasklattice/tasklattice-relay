#!/usr/bin/env bash
set -euo pipefail

control_public_url="${CONTROL_PUBLIC_URL:?CONTROL_PUBLIC_URL is required}"
keycloak_public_url="${KEYCLOAK_PUBLIC_URL:?KEYCLOAK_PUBLIC_URL is required}"
kube_context="${KUBE_CONTEXT:?KUBE_CONTEXT is required}"
namespace="${HELM_NAMESPACE:-tali}"
release_name="${HELM_RELEASE_NAME:-tali-relay}"
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for command_name in curl jq kubectl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is not installed: $command_name" >&2
    exit 1
  fi
done

control_origin="${control_public_url%/}"
issuer="${keycloak_public_url%/}/realms/tali"
temporary_directory="$(mktemp -d)"
cookie_file="$temporary_directory/cookies.txt"
trap 'rm -r -- "$temporary_directory"' EXIT

# shellcheck source=lib/dev-control-api.sh
source "$repository_root/scripts/lib/dev-control-api.sh"
dev_control_login
dev_control_api_request PUT /api/v1/access-context \
  '{"level":"platform","resourceId":null,"roleId":"ROLE_PLATFORM_ADMIN"}' \
  >/dev/null

secret_name="$({
  kubectl \
    --context "$kube_context" \
    --namespace "$namespace" \
    get secrets \
    --selector "app.kubernetes.io/instance=$release_name" \
    -o json |
    jq -r '
      [
        .items[]
        | select(.data["keycloak-client-secret"] != null)
        | .metadata.name
      ][0] // empty
    '
})"

if [[ -z "$secret_name" ]]; then
  echo "Unable to find the generated Keycloak Client secret for Helm release $namespace/$release_name." >&2
  exit 1
fi

keycloak_client_secret="$({
  kubectl \
    --context "$kube_context" \
    --namespace "$namespace" \
    get secret "$secret_name" \
    -o go-template='{{index .data "keycloak-client-secret" | base64decode}}'
})"

if [[ -z "$keycloak_client_secret" ]]; then
  echo "The Keycloak Client secret in $namespace/$secret_name is empty." >&2
  exit 1
fi

security_draft="$({
  jq --null-input \
    --arg issuer "$issuer" \
    --arg client_secret "$keycloak_client_secret" \
    '{
      localAuthenticationEnabled: true,
      sso: {
        enabled: true,
        displayName: "Keycloak",
        issuer: $issuer,
        clientId: "tali-control-plane",
        clientSecret: {
          action: "replace",
          value: $client_secret
        },
        groupClaim: "groups"
      }
    }'
})"

validation_response=""
validation_succeeded=false
validation_attempts="${KEYCLOAK_DISCOVERY_ATTEMPTS:-12}"
for ((attempt = 1; attempt <= validation_attempts; attempt += 1)); do
  if validation_response="$(dev_control_api_request POST /api/v1/platform/security/validate "$security_draft")"; then
    validation_succeeded=true
    break
  fi
  if (( attempt < validation_attempts )); then
    echo "Keycloak discovery is not ready yet; retrying SSO validation ($attempt/$validation_attempts)." >&2
    sleep 5
  fi
done

if [[ "$validation_succeeded" != "true" ]]; then
  echo "Unable to validate the Keycloak OIDC configuration after $validation_attempts attempts." >&2
  exit 1
fi

validation_token="$(jq -er '.validationToken | select(type == "string" and length > 0)' <<<"$validation_response")"
security_update="$(
  jq \
    --arg validation_token "$validation_token" \
    '. + {validationToken: $validation_token}' \
    <<<"$security_draft"
)"
dev_control_api_request PUT /api/v1/platform/security "$security_update" >/dev/null

settings_response="$(dev_control_api_request GET /api/v1/platform/settings)"
organization_response="$(dev_control_api_request GET /api/v1/platform/organization)"

if ! jq -e \
  --arg issuer "$issuer" \
  '
    .security.localAuthenticationEnabled == true
    and .security.sso.enabled == true
    and .security.sso.issuer == $issuer
  ' <<<"$settings_response" >/dev/null; then
  echo "Control did not persist the expected Local authentication and SSO settings." >&2
  exit 1
fi

department_id="$({
  jq -r '
    [
      .departments[]?
      | select(.name == "dep1" or .id == "dep1")
      | .id
    ][0] // empty
  ' <<<"$organization_response"
})"

project_ids="$({
  jq -c \
    --arg department_id "$department_id" \
    '
    [
      .departments[]?
      | select(.id == $department_id)
      | .projects[]?
      | .id
    ]
  ' <<<"$organization_response"
})"

desired_bindings="$({
  jq --null-input \
    --arg department_id "$department_id" \
    --argjson project_ids "$project_ids" \
    '[
      {
        enabled: true,
        group: "/tali/r/ROLE_PLATFORM_ADMIN",
        scope: "PLATFORM",
        departmentId: null,
        projectId: null,
        roleId: "ROLE_PLATFORM_ADMIN"
      }
    ]
    + (if $department_id == "" then [] else [
      {
        enabled: true,
        group: ("/tali/d/" + $department_id + "/r/ROLE_DEPARTMENT_ADMIN"),
        scope: "DEPARTMENT",
        departmentId: $department_id,
        projectId: null,
        roleId: "ROLE_DEPARTMENT_ADMIN"
      }
    ] end)
    + (if $department_id == "" then [] else (
      [
        "ROLE_PROJECT_ADMIN",
        "ROLE_AUDITOR",
        "ROLE_AGENT_DEVELOPER",
        "ROLE_REVIEWER",
        "ROLE_USER"
      ] as $project_roles
      | $project_ids
      | map(
          . as $project_id
          | $project_roles[]
          | {
              enabled: true,
              group: ("/tali/d/" + $department_id + "/p/" + $project_id + "/r/" + .),
              scope: "PROJECT",
              departmentId: $department_id,
              projectId: $project_id,
              roleId: .
            }
        )
    ) end)'
})"

role_bindings_update="$({
  jq \
    --argjson desired "$desired_bindings" \
    '
      def clean:
        with_entries(
          select(
            .key == "id"
            or .key == "enabled"
            or .key == "group"
            or .key == "scope"
            or .key == "departmentId"
            or .key == "projectId"
            or .key == "roleId"
          )
        );

      reduce $desired[] as $wanted (
        [(.security.sso.roleBindings // [])[] | clean];
        if any(.[]; .group == $wanted.group) then
          map(if .group == $wanted.group then . + $wanted else . end)
        else
          . + [$wanted]
        end
      )
      | {bindings: .}
    ' <<<"$settings_response"
})"

dev_control_api_request PUT /api/v1/platform/security/role-bindings "$role_bindings_update" >/dev/null

auth_config="$(dev_control_api_request GET /api/v1/auth/config)"
if [[ "$(jq -r '.ssoEnabled // false' <<<"$auth_config")" != "true" ]]; then
  echo "Control did not report SSO as enabled after saving the configuration." >&2
  exit 1
fi

signing_key_count="$(jq -r '.signingKeyCount // 0' <<<"$validation_response")"
role_binding_count="$(jq -r '.bindings | length' <<<"$role_bindings_update")"
echo "Configured Control SSO with Keycloak ($signing_key_count signing keys, $role_binding_count role bindings)."

if [[ -z "$department_id" || "$(jq 'length' <<<"$project_ids")" == "0" ]]; then
  echo "The development Department or Projects do not exist yet; their test role bindings will be added on the next deployment." >&2
fi
