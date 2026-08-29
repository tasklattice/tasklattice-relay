INSERT INTO tasklattice.sandbox_policies (
  project_id,
  id,
  payload,
  created_at,
  deleted_at
)
SELECT
  project.id,
  'managed-runtime',
  '{"id":"managed-runtime","name":"Managed Runtime","description":"Provides the writable Agent runtime baseline while denying undeclared outbound destinations.","networkAccess":"Managed Providers only · Toolbox grants are composed explicitly","policyYaml":"version: 1\nfilesystem_policy:\n  include_workdir: true\n  read_only:\n    - /usr\n    - /opt\n    - /lib\n    - /proc\n    - /dev/urandom\n    - /etc\n    - /var/log\n  read_write:\n    - /sandbox\n    - /tmp\n    - /dev/null\nlandlock:\n  compatibility: best_effort\nprocess:\n  run_as_user: sandbox\n  run_as_group: sandbox\nnetwork_policies: {}\n","enforcement":"ENFORCE","source":"BUILT_IN","immutable":true}'::jsonb,
  to_timestamp(0),
  NULL
FROM tasklattice.projects AS project
WHERE project.deleted_at IS NULL
ON CONFLICT (project_id, id) DO UPDATE
SET payload = EXCLUDED.payload,
    deleted_at = NULL;

UPDATE tasklattice.agents
SET payload = jsonb_set(payload, '{policyId}', '"managed-runtime"'::jsonb, true),
    updated_at = now()
WHERE payload->>'policyId' IN ('unrestricted', 'restricted');

UPDATE tasklattice.sandbox_policies
SET deleted_at = COALESCE(deleted_at, now())
WHERE id IN ('unrestricted', 'restricted');
