CREATE TABLE tasklattice.personal_onboarding (
  project_id text PRIMARY KEY REFERENCES tasklattice.projects(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status text NOT NULL DEFAULT 'EMPTY', state jsonb NOT NULL DEFAULT '{}',
  operation_id text, lease_until timestamptz, error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tasklattice.managed_secrets (
  project_id text NOT NULL REFERENCES tasklattice.projects(id) ON DELETE CASCADE,
  resource_id text NOT NULL, ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, resource_id)
);
ALTER TABLE tasklattice.agents DROP CONSTRAINT agents_kind_check;
ALTER TABLE tasklattice.agents ADD CONSTRAINT agents_kind_check
  CHECK (kind IN ('SUPERVISOR', 'A2A', 'PROJECT_AGENT', 'WORK_AGENT'));
ALTER TABLE tasklattice.agents DROP CONSTRAINT agents_catalog_agent_shape_check;
ALTER TABLE tasklattice.agents ADD CONSTRAINT agents_catalog_agent_shape_check CHECK (
  (kind IN ('SUPERVISOR','PROJECT_AGENT') AND catalog_agent_id IS NULL) OR
  (kind = 'A2A' AND catalog_agent_id IS NOT NULL) OR
  (kind = 'WORK_AGENT' AND catalog_agent_id IS NULL AND developed_agent_id IS NOT NULL AND agent_version_id IS NOT NULL)
);
