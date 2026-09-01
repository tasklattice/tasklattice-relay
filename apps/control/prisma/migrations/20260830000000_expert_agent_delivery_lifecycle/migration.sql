CREATE TYPE tasklattice.expert_agent_relation AS ENUM ('OWNER', 'MAINTAINER');
CREATE TYPE tasklattice.expert_agent_execution_mode AS ENUM ('AGENTIC', 'WORKFLOW');

ALTER TABLE tasklattice.project_runs
  ADD COLUMN expert_agent_id UUID,
  ADD COLUMN expert_agent_version_id UUID,
  ADD COLUMN expert_engine_version TEXT,
  ADD COLUMN expert_trace JSONB;

CREATE INDEX project_runs_expert_agent_version_started_idx
  ON tasklattice.project_runs(
    project_id,
    expert_agent_id,
    expert_agent_version_id,
    started_at DESC
  );

CREATE TABLE tasklattice.expert_agents (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  execution_mode tasklattice.expert_agent_execution_mode NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ(6),
  CONSTRAINT expert_agents_pkey PRIMARY KEY (project_id, id),
  CONSTRAINT expert_agents_project_fkey
    FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON DELETE CASCADE,
  CONSTRAINT expert_agents_creator_membership_fkey
    FOREIGN KEY (project_id, created_by)
    REFERENCES tasklattice.project_members(project_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT expert_agents_slug_check
    CHECK (slug ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')
);

CREATE UNIQUE INDEX expert_agents_project_slug_key
  ON tasklattice.expert_agents(project_id, slug);
CREATE INDEX expert_agents_project_mode_updated_idx
  ON tasklattice.expert_agents(project_id, execution_mode, updated_at DESC);
CREATE INDEX expert_agents_project_active_updated_idx
  ON tasklattice.expert_agents(project_id, deleted_at, updated_at DESC);

CREATE TABLE tasklattice.expert_agent_members (
  project_id TEXT NOT NULL,
  agent_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  relation tasklattice.expert_agent_relation NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT expert_agent_members_pkey PRIMARY KEY (project_id, agent_id, user_id),
  CONSTRAINT expert_agent_members_agent_fkey
    FOREIGN KEY (project_id, agent_id)
    REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE,
  CONSTRAINT expert_agent_members_project_membership_fkey
    FOREIGN KEY (project_id, user_id)
    REFERENCES tasklattice.project_members(project_id, user_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX expert_agent_members_single_owner_key
  ON tasklattice.expert_agent_members(project_id, agent_id)
  WHERE relation = 'OWNER';
CREATE INDEX expert_agent_members_user_relation_idx
  ON tasklattice.expert_agent_members(project_id, user_id, relation);

CREATE TABLE tasklattice.expert_agent_working_copies (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  base_version_id UUID,
  revision INTEGER NOT NULL DEFAULT 0,
  product_spec JSONB NOT NULL,
  acceptance_spec JSONB NOT NULL,
  safety_spec JSONB NOT NULL,
  execution_spec JSONB NOT NULL,
  resource_bindings JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT expert_agent_working_copies_pkey PRIMARY KEY (project_id, id),
  CONSTRAINT expert_agent_working_copies_agent_fkey
    FOREIGN KEY (project_id, agent_id)
    REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE,
  CONSTRAINT expert_agent_working_copies_revision_check CHECK (revision >= 0)
);

CREATE UNIQUE INDEX expert_agent_working_copies_agent_key
  ON tasklattice.expert_agent_working_copies(project_id, agent_id);

CREATE TABLE tasklattice.expert_agent_candidates (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  working_copy_id UUID NOT NULL,
  working_copy_revision INTEGER NOT NULL,
  content_digest TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT expert_agent_candidates_pkey PRIMARY KEY (project_id, id),
  CONSTRAINT expert_agent_candidates_agent_fkey
    FOREIGN KEY (project_id, agent_id)
    REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE,
  CONSTRAINT expert_agent_candidates_working_copy_fkey
    FOREIGN KEY (project_id, working_copy_id)
    REFERENCES tasklattice.expert_agent_working_copies(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT expert_agent_candidates_revision_check CHECK (working_copy_revision >= 0),
  CONSTRAINT expert_agent_candidates_digest_check
    CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX expert_agent_candidates_digest_key
  ON tasklattice.expert_agent_candidates(project_id, agent_id, content_digest);
CREATE UNIQUE INDEX expert_agent_candidates_working_copy_revision_key
  ON tasklattice.expert_agent_candidates(project_id, working_copy_id, working_copy_revision);
CREATE INDEX expert_agent_candidates_agent_created_idx
  ON tasklattice.expert_agent_candidates(project_id, agent_id, created_at DESC);

CREATE TABLE tasklattice.expert_agent_validation_runs (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  candidate_digest TEXT NOT NULL,
  kind TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  evidence JSONB,
  failure_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ(6),
  finished_at TIMESTAMPTZ(6),
  CONSTRAINT expert_agent_validation_runs_pkey PRIMARY KEY (project_id, id),
  CONSTRAINT expert_agent_validation_runs_agent_fkey
    FOREIGN KEY (project_id, agent_id)
    REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE,
  CONSTRAINT expert_agent_validation_runs_candidate_fkey
    FOREIGN KEY (project_id, candidate_id)
    REFERENCES tasklattice.expert_agent_candidates(project_id, id) ON DELETE CASCADE,
  CONSTRAINT expert_agent_validation_runs_digest_check
    CHECK (candidate_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT expert_agent_validation_runs_kind_check
    CHECK (kind IN ('CONTRACT', 'FUNCTIONAL', 'SECURITY', 'A2A')),
  CONSTRAINT expert_agent_validation_runs_status_check
    CHECK (status IN ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED')),
  CONSTRAINT expert_agent_validation_runs_attempt_check CHECK (attempt > 0),
  CONSTRAINT expert_agent_validation_runs_time_check
    CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

CREATE UNIQUE INDEX expert_agent_validation_runs_attempt_key
  ON tasklattice.expert_agent_validation_runs(project_id, candidate_id, kind, attempt);
CREATE INDEX expert_agent_validation_runs_agent_status_idx
  ON tasklattice.expert_agent_validation_runs(project_id, agent_id, status, created_at DESC);

CREATE TABLE tasklattice.expert_agent_versions (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  release_id TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  published_by TEXT NOT NULL,
  published_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT expert_agent_versions_pkey PRIMARY KEY (project_id, id),
  CONSTRAINT expert_agent_versions_agent_fkey
    FOREIGN KEY (project_id, agent_id)
    REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE,
  CONSTRAINT expert_agent_versions_candidate_fkey
    FOREIGN KEY (project_id, candidate_id)
    REFERENCES tasklattice.expert_agent_candidates(project_id, id) ON DELETE RESTRICT,
  CONSTRAINT expert_agent_versions_release_id_check
    CHECK (release_id ~ '^[0-9]{8}-[0-9]{4}(-[a-z0-9]+)?$'),
  CONSTRAINT expert_agent_versions_digest_check
    CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX expert_agent_versions_candidate_key
  ON tasklattice.expert_agent_versions(project_id, candidate_id);
CREATE UNIQUE INDEX expert_agent_versions_release_key
  ON tasklattice.expert_agent_versions(project_id, agent_id, release_id);
CREATE INDEX expert_agent_versions_agent_published_idx
  ON tasklattice.expert_agent_versions(project_id, agent_id, published_at DESC);

ALTER TABLE tasklattice.expert_agent_working_copies
  ADD CONSTRAINT expert_agent_working_copies_base_version_fkey
  FOREIGN KEY (project_id, base_version_id)
  REFERENCES tasklattice.expert_agent_versions(project_id, id) ON DELETE NO ACTION;

CREATE TABLE tasklattice.expert_agent_deployments (
  project_id TEXT NOT NULL,
  agent_id UUID NOT NULL,
  active_version_id UUID,
  status TEXT NOT NULL DEFAULT 'INACTIVE',
  runtime_endpoint TEXT,
  engine_version TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  activated_at TIMESTAMPTZ(6),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT expert_agent_deployments_pkey PRIMARY KEY (project_id, agent_id),
  CONSTRAINT expert_agent_deployments_agent_fkey
    FOREIGN KEY (project_id, agent_id)
    REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE,
  CONSTRAINT expert_agent_deployments_active_version_fkey
    FOREIGN KEY (project_id, active_version_id)
    REFERENCES tasklattice.expert_agent_versions(project_id, id) ON DELETE NO ACTION,
  CONSTRAINT expert_agent_deployments_status_check
    CHECK (status IN ('INACTIVE', 'ACTIVATING', 'READY', 'DEGRADED', 'FAILED')),
  CONSTRAINT expert_agent_deployments_revision_check CHECK (revision >= 0)
);

CREATE INDEX expert_agent_deployments_status_idx
  ON tasklattice.expert_agent_deployments(project_id, status, updated_at DESC);

CREATE TABLE tasklattice.expert_agent_activations (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  action TEXT NOT NULL,
  from_version_id UUID,
  to_version_id UUID,
  status TEXT NOT NULL,
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ(6),
  CONSTRAINT expert_agent_activations_pkey PRIMARY KEY (project_id, id),
  CONSTRAINT expert_agent_activations_agent_fkey
    FOREIGN KEY (project_id, agent_id)
    REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE,
  CONSTRAINT expert_agent_activations_from_version_fkey
    FOREIGN KEY (project_id, from_version_id)
    REFERENCES tasklattice.expert_agent_versions(project_id, id) ON DELETE NO ACTION,
  CONSTRAINT expert_agent_activations_to_version_fkey
    FOREIGN KEY (project_id, to_version_id)
    REFERENCES tasklattice.expert_agent_versions(project_id, id) ON DELETE NO ACTION,
  CONSTRAINT expert_agent_activations_action_check
    CHECK (action IN ('ACTIVATE', 'ROLLBACK', 'DEACTIVATE')),
  CONSTRAINT expert_agent_activations_status_check
    CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT expert_agent_activations_target_check
    CHECK (
      (action = 'DEACTIVATE' AND to_version_id IS NULL)
      OR (action IN ('ACTIVATE', 'ROLLBACK') AND to_version_id IS NOT NULL)
    )
);

CREATE INDEX expert_agent_activations_agent_created_idx
  ON tasklattice.expert_agent_activations(project_id, agent_id, created_at DESC);

CREATE FUNCTION tasklattice.validate_expert_agent_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_agent_id UUID;
  referenced_digest TEXT;
BEGIN
  IF TG_TABLE_NAME = 'expert_agent_working_copies' THEN
    IF NEW.base_version_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT agent_id INTO referenced_agent_id
      FROM tasklattice.expert_agent_versions
      WHERE project_id = NEW.project_id AND id = NEW.base_version_id;
  ELSIF TG_TABLE_NAME = 'expert_agent_candidates' THEN
    SELECT agent_id INTO referenced_agent_id
      FROM tasklattice.expert_agent_working_copies
      WHERE project_id = NEW.project_id AND id = NEW.working_copy_id;
  ELSIF TG_TABLE_NAME = 'expert_agent_validation_runs' THEN
    SELECT agent_id, content_digest INTO referenced_agent_id, referenced_digest
      FROM tasklattice.expert_agent_candidates
      WHERE project_id = NEW.project_id AND id = NEW.candidate_id;
    IF referenced_digest IS DISTINCT FROM NEW.candidate_digest THEN
      RAISE EXCEPTION 'Validation evidence must reference the exact Candidate digest';
    END IF;
  ELSIF TG_TABLE_NAME = 'expert_agent_versions' THEN
    SELECT agent_id, content_digest INTO referenced_agent_id, referenced_digest
      FROM tasklattice.expert_agent_candidates
      WHERE project_id = NEW.project_id AND id = NEW.candidate_id;
    IF referenced_digest IS DISTINCT FROM NEW.content_digest THEN
      RAISE EXCEPTION 'Published Version digest must match its Candidate digest';
    END IF;
  ELSIF TG_TABLE_NAME = 'expert_agent_deployments' THEN
    IF NEW.active_version_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT agent_id INTO referenced_agent_id
      FROM tasklattice.expert_agent_versions
      WHERE project_id = NEW.project_id AND id = NEW.active_version_id;
  END IF;

  IF referenced_agent_id IS DISTINCT FROM NEW.agent_id THEN
    RAISE EXCEPTION 'Referenced Expert Agent object belongs to another Agent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER expert_agent_working_copies_reference_guard
  BEFORE INSERT OR UPDATE ON tasklattice.expert_agent_working_copies
  FOR EACH ROW EXECUTE FUNCTION tasklattice.validate_expert_agent_reference();
CREATE TRIGGER expert_agent_candidates_reference_guard
  BEFORE INSERT OR UPDATE ON tasklattice.expert_agent_candidates
  FOR EACH ROW EXECUTE FUNCTION tasklattice.validate_expert_agent_reference();
CREATE TRIGGER expert_agent_validation_runs_reference_guard
  BEFORE INSERT OR UPDATE ON tasklattice.expert_agent_validation_runs
  FOR EACH ROW EXECUTE FUNCTION tasklattice.validate_expert_agent_reference();
CREATE TRIGGER expert_agent_versions_reference_guard
  BEFORE INSERT OR UPDATE ON tasklattice.expert_agent_versions
  FOR EACH ROW EXECUTE FUNCTION tasklattice.validate_expert_agent_reference();
CREATE TRIGGER expert_agent_deployments_reference_guard
  BEFORE INSERT OR UPDATE ON tasklattice.expert_agent_deployments
  FOR EACH ROW EXECUTE FUNCTION tasklattice.validate_expert_agent_reference();

CREATE FUNCTION tasklattice.validate_expert_agent_activation_versions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_agent_id UUID;
BEGIN
  IF NEW.from_version_id IS NOT NULL THEN
    SELECT agent_id INTO referenced_agent_id
      FROM tasklattice.expert_agent_versions
      WHERE project_id = NEW.project_id AND id = NEW.from_version_id;
    IF referenced_agent_id IS DISTINCT FROM NEW.agent_id THEN
      RAISE EXCEPTION 'Activation source Version belongs to another Agent';
    END IF;
  END IF;
  IF NEW.to_version_id IS NOT NULL THEN
    SELECT agent_id INTO referenced_agent_id
      FROM tasklattice.expert_agent_versions
      WHERE project_id = NEW.project_id AND id = NEW.to_version_id;
    IF referenced_agent_id IS DISTINCT FROM NEW.agent_id THEN
      RAISE EXCEPTION 'Activation target Version belongs to another Agent';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER expert_agent_activations_reference_guard
  BEFORE INSERT OR UPDATE ON tasklattice.expert_agent_activations
  FOR EACH ROW EXECUTE FUNCTION tasklattice.validate_expert_agent_activation_versions();

CREATE FUNCTION tasklattice.reject_expert_agent_immutable_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; create a new Candidate or Version instead', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER expert_agent_candidates_immutable_update
  BEFORE UPDATE ON tasklattice.expert_agent_candidates
  FOR EACH ROW EXECUTE FUNCTION tasklattice.reject_expert_agent_immutable_update();
CREATE TRIGGER expert_agent_versions_immutable_update
  BEFORE UPDATE ON tasklattice.expert_agent_versions
  FOR EACH ROW EXECUTE FUNCTION tasklattice.reject_expert_agent_immutable_update();
