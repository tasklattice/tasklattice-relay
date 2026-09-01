-- Agent Developer is still pre-release. Replace the early Working Copy /
-- Candidate / Deployment lifecycle instead of preserving a compatibility path.

UPDATE tasklattice.project_runs
SET expert_agent_id = NULL,
    expert_agent_version_id = NULL,
    expert_engine_version = NULL,
    expert_trace = NULL
WHERE expert_agent_id IS NOT NULL;

DELETE FROM tasklattice.agents WHERE kind = 'PROJECT_AGENT';

ALTER TABLE tasklattice.agents
  DROP CONSTRAINT agents_kind_check,
  DROP CONSTRAINT agents_catalog_agent_shape_check,
  ADD CONSTRAINT agents_kind_check
    CHECK (kind IN ('SUPERVISOR', 'A2A', 'PROJECT_AGENT')),
  ADD CONSTRAINT agents_catalog_agent_shape_check
    CHECK (
      (kind = 'SUPERVISOR' AND catalog_agent_id IS NULL)
      OR (kind = 'A2A' AND catalog_agent_id IS NOT NULL)
      OR (kind = 'PROJECT_AGENT' AND catalog_agent_id IS NULL)
    );

DROP FUNCTION IF EXISTS tasklattice.validate_expert_agent_activation_versions() CASCADE;
DROP FUNCTION IF EXISTS tasklattice.validate_expert_agent_reference() CASCADE;
DROP FUNCTION IF EXISTS tasklattice.reject_expert_agent_immutable_update() CASCADE;

DROP TABLE IF EXISTS tasklattice.expert_agent_activations CASCADE;
DROP TABLE IF EXISTS tasklattice.expert_agent_deployments CASCADE;
DROP TABLE IF EXISTS tasklattice.expert_agent_validation_runs CASCADE;
DROP TABLE IF EXISTS tasklattice.expert_agent_versions CASCADE;
DROP TABLE IF EXISTS tasklattice.expert_agent_candidates CASCADE;
DROP TABLE IF EXISTS tasklattice.expert_agent_working_copy_evaluation_runs CASCADE;
DROP TABLE IF EXISTS tasklattice.expert_agent_working_copies CASCADE;

-- Existing development data used the removed lifecycle and cannot be represented
-- faithfully by the new aggregate. Project, people, and capability resources remain.
TRUNCATE TABLE tasklattice.expert_agents CASCADE;

ALTER TABLE tasklattice.expert_agents
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN content_digest TEXT NOT NULL,
  ADD COLUMN product_spec JSONB NOT NULL,
  ADD COLUMN policy_spec JSONB NOT NULL,
  ADD COLUMN delegation_spec JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN acceptance_spec JSONB NOT NULL,
  ADD COLUMN safety_spec JSONB NOT NULL,
  ADD COLUMN execution_spec JSONB NOT NULL,
  ADD COLUMN resource_bindings JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN latest_released_version_id UUID,
  ADD COLUMN updated_by TEXT NOT NULL,
  ADD CONSTRAINT expert_agents_revision_check CHECK (revision >= 0),
  ADD CONSTRAINT expert_agents_digest_check
    CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  ADD CONSTRAINT expert_agents_updater_membership_fkey
    FOREIGN KEY (project_id, updated_by)
    REFERENCES tasklattice.project_members(project_id, user_id) ON DELETE RESTRICT;

CREATE TABLE tasklattice.expert_agent_test_runs (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  agent_revision INTEGER NOT NULL,
  content_digest TEXT NOT NULL,
  mode TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  evidence JSONB NOT NULL,
  failure_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ(6) NOT NULL,
  finished_at TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT expert_agent_test_runs_pkey PRIMARY KEY (project_id, id),
  CONSTRAINT expert_agent_test_runs_agent_fkey
    FOREIGN KEY (project_id, agent_id)
    REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE,
  CONSTRAINT expert_agent_test_runs_revision_check CHECK (agent_revision >= 0),
  CONSTRAINT expert_agent_test_runs_digest_check
    CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT expert_agent_test_runs_mode_check
    CHECK (mode IN ('QUICK', 'RELEASE')),
  CONSTRAINT expert_agent_test_runs_status_check
    CHECK (status IN ('PASSED', 'FAILED', 'CANCELLED')),
  CONSTRAINT expert_agent_test_runs_attempt_check CHECK (attempt > 0),
  CONSTRAINT expert_agent_test_runs_time_check CHECK (finished_at >= started_at)
);

CREATE UNIQUE INDEX expert_agent_test_runs_attempt_key
  ON tasklattice.expert_agent_test_runs(
    project_id, agent_id, agent_revision, mode, attempt
  );
CREATE INDEX expert_agent_test_runs_agent_created_idx
  ON tasklattice.expert_agent_test_runs(project_id, agent_id, mode, created_at DESC);
CREATE INDEX expert_agent_test_runs_digest_status_idx
  ON tasklattice.expert_agent_test_runs(project_id, agent_id, content_digest, status);

CREATE TABLE tasklattice.expert_agent_versions (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  version_number INTEGER NOT NULL,
  source_revision INTEGER NOT NULL,
  content_digest TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  manifest JSONB NOT NULL,
  manifest_digest TEXT NOT NULL,
  artifact_set_digest TEXT NOT NULL,
  release_notes TEXT,
  garden_status TEXT NOT NULL DEFAULT 'PUBLISHED',
  published_by TEXT NOT NULL,
  published_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT expert_agent_versions_pkey PRIMARY KEY (project_id, id),
  CONSTRAINT expert_agent_versions_agent_fkey
    FOREIGN KEY (project_id, agent_id)
    REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE,
  CONSTRAINT expert_agent_versions_number_check CHECK (version_number > 0),
  CONSTRAINT expert_agent_versions_revision_check CHECK (source_revision >= 0),
  CONSTRAINT expert_agent_versions_digest_check
    CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT expert_agent_versions_manifest_digest_check
    CHECK (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT expert_agent_versions_artifact_set_digest_check
    CHECK (artifact_set_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT expert_agent_versions_garden_status_check
    CHECK (garden_status IN ('PUBLISHED', 'WITHDRAWN'))
);

CREATE UNIQUE INDEX expert_agent_versions_number_key
  ON tasklattice.expert_agent_versions(project_id, agent_id, version_number);
CREATE UNIQUE INDEX expert_agent_versions_digest_key
  ON tasklattice.expert_agent_versions(project_id, agent_id, content_digest);
CREATE INDEX expert_agent_versions_agent_published_idx
  ON tasklattice.expert_agent_versions(project_id, agent_id, published_at DESC);

ALTER TABLE tasklattice.expert_agents
  ADD CONSTRAINT expert_agents_latest_released_version_fkey
  FOREIGN KEY (project_id, latest_released_version_id)
  REFERENCES tasklattice.expert_agent_versions(project_id, id) ON DELETE NO ACTION;

CREATE TABLE tasklattice.expert_agent_version_artifacts (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL,
  kind TEXT NOT NULL,
  media_type TEXT NOT NULL,
  digest TEXT NOT NULL,
  uri TEXT NOT NULL,
  size_bytes INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT expert_agent_version_artifacts_pkey PRIMARY KEY (project_id, id),
  CONSTRAINT expert_agent_version_artifacts_version_fkey
    FOREIGN KEY (project_id, version_id)
    REFERENCES tasklattice.expert_agent_versions(project_id, id) ON DELETE CASCADE,
  CONSTRAINT expert_agent_version_artifacts_digest_check
    CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT expert_agent_version_artifacts_size_check
    CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

CREATE UNIQUE INDEX expert_agent_version_artifacts_kind_digest_key
  ON tasklattice.expert_agent_version_artifacts(project_id, version_id, kind, digest);
CREATE INDEX expert_agent_version_artifacts_version_idx
  ON tasklattice.expert_agent_version_artifacts(project_id, version_id);

ALTER TABLE tasklattice.agents
  ADD COLUMN developed_agent_id UUID,
  ADD COLUMN agent_version_id UUID,
  ADD CONSTRAINT agents_developed_agent_fkey
    FOREIGN KEY (project_id, developed_agent_id)
    REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT agents_agent_version_fkey
    FOREIGN KEY (project_id, agent_version_id)
    REFERENCES tasklattice.expert_agent_versions(project_id, id) ON DELETE RESTRICT;

CREATE INDEX agents_project_kind_developed_idx
  ON tasklattice.agents(project_id, kind, developed_agent_id);
CREATE INDEX agents_project_version_idx
  ON tasklattice.agents(project_id, agent_version_id);

CREATE FUNCTION tasklattice.validate_agent_release_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_agent_id UUID;
BEGIN
  IF NEW.latest_released_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT agent_id INTO referenced_agent_id
    FROM tasklattice.expert_agent_versions
    WHERE project_id = NEW.project_id AND id = NEW.latest_released_version_id;
  IF referenced_agent_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Latest released Version belongs to another Agent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER expert_agents_latest_release_guard
  BEFORE INSERT OR UPDATE ON tasklattice.expert_agents
  FOR EACH ROW EXECUTE FUNCTION tasklattice.validate_agent_release_reference();

CREATE FUNCTION tasklattice.validate_agent_instance_version_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_agent_id UUID;
BEGIN
  IF NEW.kind <> 'PROJECT_AGENT' THEN
    IF NEW.developed_agent_id IS NOT NULL OR NEW.agent_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only PROJECT_AGENT Instances may reference a developed Agent Version';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.developed_agent_id IS NULL OR NEW.agent_version_id IS NULL THEN
    RAISE EXCEPTION 'PROJECT_AGENT Instances require an Agent and Version';
  END IF;
  SELECT agent_id INTO referenced_agent_id
    FROM tasklattice.expert_agent_versions
    WHERE project_id = NEW.project_id AND id = NEW.agent_version_id;
  IF referenced_agent_id IS DISTINCT FROM NEW.developed_agent_id THEN
    RAISE EXCEPTION 'Instance Version belongs to another Agent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agents_developed_version_guard
  BEFORE INSERT OR UPDATE ON tasklattice.agents
  FOR EACH ROW EXECUTE FUNCTION tasklattice.validate_agent_instance_version_reference();

CREATE FUNCTION tasklattice.reject_agent_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; release a new Version instead', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER expert_agent_versions_immutable_update
  BEFORE UPDATE ON tasklattice.expert_agent_versions
  FOR EACH ROW EXECUTE FUNCTION tasklattice.reject_agent_version_update();
CREATE TRIGGER expert_agent_version_artifacts_immutable_update
  BEFORE UPDATE ON tasklattice.expert_agent_version_artifacts
  FOR EACH ROW EXECUTE FUNCTION tasklattice.reject_agent_version_update();
