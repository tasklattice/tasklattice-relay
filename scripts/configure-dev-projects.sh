#!/usr/bin/env bash
set -euo pipefail

control_public_url="${CONTROL_PUBLIC_URL:?CONTROL_PUBLIC_URL is required}"
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
projects_file="${CONTROL_DEVELOPMENT_PROJECTS_FILE:-$repository_root/config/development-projects.json}"

for command_name in curl jq; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is not installed: $command_name" >&2
    exit 1
  fi
done

if [[ ! -f "$projects_file" ]]; then
  echo "Development Project configuration does not exist: $projects_file" >&2
  exit 1
fi
if ! jq -e '
  type == "array"
  and length > 0
  and all(.[];
    (.departmentId | type == "string" and length > 0)
    and (.id | type == "string" and test("^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$"))
    and (.name | type == "string" and length > 0)
  )
  and ([.[].id] | length == (unique | length))
' "$projects_file" >/dev/null; then
  echo "Development Project configuration is invalid: $projects_file" >&2
  exit 1
fi

control_origin="${control_public_url%/}"
temporary_directory="$(mktemp -d)"
cookie_file="$temporary_directory/cookies.txt"
trap 'rm -r -- "$temporary_directory"' EXIT

# shellcheck source=lib/dev-control-api.sh
source "$repository_root/scripts/lib/dev-control-api.sh"
dev_control_login
dev_control_api_request PUT /api/v1/access-context \
  '{"level":"platform","resourceId":null,"roleId":"ROLE_PLATFORM_ADMIN"}' \
  >/dev/null

organization_response="$(dev_control_api_request GET /api/v1/platform/organization)"
created_count=0
existing_count=0

while IFS= read -r configured_project; do
  department_id="$(jq -r '.departmentId' <<<"$configured_project")"
  project_id="$(jq -r '.id' <<<"$configured_project")"
  project_name="$(jq -r '.name' <<<"$configured_project")"
  existing_project="$({
    jq --arg project_id "$project_id" '
      [
        .departments[]? as $department
        | $department.projects[]?
        | select(.id == $project_id)
        | . + {departmentId: $department.id}
      ][0] // null
    ' <<<"$organization_response"
  })"

  if [[ "$existing_project" != "null" ]]; then
    if ! jq -e \
      --arg department_id "$department_id" \
      --arg project_name "$project_name" \
      '.departmentId == $department_id and .name == $project_name' \
      <<<"$existing_project" >/dev/null; then
      echo "Development Project $project_id exists with different name or Department metadata." >&2
      exit 1
    fi
    ((existing_count += 1))
    continue
  fi

  if ! jq -e --arg department_id "$department_id" \
    'any(.departments[]?; .id == $department_id)' \
    <<<"$organization_response" >/dev/null; then
    echo "Development Department does not exist: $department_id" >&2
    exit 1
  fi

  payload="$({
    jq --null-input \
      --arg department_id "$department_id" \
      --arg project_id "$project_id" \
      --arg project_name "$project_name" \
      '{
        departmentId: $department_id,
        id: $project_id,
        name: $project_name,
        invitations: []
      }'
  })"
  dev_control_api_request POST /api/v1/platform/projects "$payload" >/dev/null
  ((created_count += 1))
done < <(jq -c '.[]' "$projects_file")

project_count="$(jq 'length' "$projects_file")"
echo "Configured $project_count development Projects ($created_count created, $existing_count existing)."
