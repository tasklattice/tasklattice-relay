CREATE TYPE tasklattice.memory_status AS ENUM (
  'provisioning',
  'ready',
  'degraded',
  'unbound',
  'deleting',
  'deletion_failed',
  'deleted'
);

CREATE TYPE tasklattice.memory_binding_status AS ENUM (
  'pending',
  'active',
  'detached'
);

CREATE TYPE tasklattice.memory_runtime_type AS ENUM ('openclaw', 'hermes');
CREATE TYPE tasklattice.memory_binding_kind AS ENUM ('primary');

CREATE TYPE tasklattice.memory_outbox_status AS ENUM (
  'pending',
  'processing',
  'retry',
  'delivered',
  'dead_letter'
);

CREATE TYPE tasklattice.memory_experience_status AS ENUM (
  'active',
  'invalidated'
);

CREATE TABLE tasklattice.memories (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'hindsight',
  provider_ref TEXT,
  status tasklattice.memory_status NOT NULL DEFAULT 'provisioning',
  retention_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT,
  last_activity_at TIMESTAMPTZ,
  last_error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (project_id, id),
  CONSTRAINT memories_project_fkey
    FOREIGN KEY (project_id)
    REFERENCES tasklattice.projects(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT memories_display_name_check
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  CONSTRAINT memories_retention_policy_object_check
    CHECK (jsonb_typeof(retention_policy) = 'object'),
  CONSTRAINT memories_deleted_state_check
    CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CONSTRAINT memories_deleted_provider_ref_check
    CHECK (status <> 'deleted' OR provider_ref IS NULL)
);

CREATE UNIQUE INDEX memories_project_idempotency_key
  ON tasklattice.memories(project_id, idempotency_key);

CREATE UNIQUE INDEX memories_project_provider_ref_key
  ON tasklattice.memories(project_id, provider, provider_ref);

CREATE INDEX memories_project_status_updated_idx
  ON tasklattice.memories(project_id, status, updated_at DESC);

CREATE INDEX memories_project_activity_idx
  ON tasklattice.memories(project_id, last_activity_at DESC);

CREATE TABLE tasklattice.memory_bindings (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL,
  instance_id TEXT NOT NULL,
  runtime_type tasklattice.memory_runtime_type NOT NULL,
  binding_kind tasklattice.memory_binding_kind NOT NULL DEFAULT 'primary',
  status tasklattice.memory_binding_status NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  attached_at TIMESTAMPTZ,
  detached_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT memory_bindings_memory_fkey
    FOREIGN KEY (project_id, memory_id)
    REFERENCES tasklattice.memories(project_id, id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT memory_bindings_instance_fkey
    FOREIGN KEY (project_id, instance_id)
    REFERENCES tasklattice.agents(project_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT memory_bindings_lifecycle_time_check CHECK (
    (status = 'pending' AND attached_at IS NULL AND detached_at IS NULL)
    OR (status = 'active' AND attached_at IS NOT NULL AND detached_at IS NULL)
    OR (status = 'detached' AND detached_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX memory_bindings_project_idempotency_key
  ON tasklattice.memory_bindings(project_id, idempotency_key);

CREATE UNIQUE INDEX memory_bindings_active_primary_instance_key
  ON tasklattice.memory_bindings(project_id, instance_id)
  WHERE status = 'active' AND binding_kind = 'primary';

CREATE UNIQUE INDEX memory_bindings_active_primary_memory_key
  ON tasklattice.memory_bindings(project_id, memory_id)
  WHERE status = 'active' AND binding_kind = 'primary';

CREATE INDEX memory_bindings_memory_history_idx
  ON tasklattice.memory_bindings(project_id, memory_id, created_at DESC);

CREATE INDEX memory_bindings_instance_history_idx
  ON tasklattice.memory_bindings(project_id, instance_id, created_at DESC);

CREATE TABLE tasklattice.memory_outbox (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL,
  conversation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  encrypted_payload TEXT,
  payload_ref TEXT,
  status tasklattice.memory_outbox_status NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_summary TEXT,
  idempotency_key TEXT NOT NULL,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT memory_outbox_memory_fkey
    FOREIGN KEY (project_id, memory_id)
    REFERENCES tasklattice.memories(project_id, id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT memory_outbox_payload_check
    CHECK ((encrypted_payload IS NOT NULL) <> (payload_ref IS NOT NULL)),
  CONSTRAINT memory_outbox_retry_count_check CHECK (retry_count >= 0),
  CONSTRAINT memory_outbox_delivery_check CHECK (
    (status = 'delivered' AND delivered_at IS NOT NULL)
    OR (status <> 'delivered' AND delivered_at IS NULL)
  )
);

CREATE UNIQUE INDEX memory_outbox_project_idempotency_key
  ON tasklattice.memory_outbox(project_id, idempotency_key);

CREATE INDEX memory_outbox_due_idx
  ON tasklattice.memory_outbox(status, next_retry_at, created_at);

CREATE INDEX memory_outbox_memory_idx
  ON tasklattice.memory_outbox(project_id, memory_id, created_at DESC);

CREATE TABLE tasklattice.memory_curation_events (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL,
  provider_item_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_snapshot JSONB,
  after_snapshot JSONB,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT memory_curation_events_memory_fkey
    FOREIGN KEY (project_id, memory_id)
    REFERENCES tasklattice.memories(project_id, id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX memory_curation_events_memory_idx
  ON tasklattice.memory_curation_events(project_id, memory_id, created_at DESC);

CREATE INDEX memory_curation_events_item_idx
  ON tasklattice.memory_curation_events(project_id, memory_id, provider_item_id);

CREATE TABLE tasklattice.memory_experience_projections (
  project_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  situation TEXT NOT NULL,
  goal TEXT NOT NULL,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  outcome TEXT NOT NULL,
  lesson_learned TEXT NOT NULL,
  status tasklattice.memory_experience_status NOT NULL DEFAULT 'active',
  occurred_start TIMESTAMPTZ,
  occurred_end TIMESTAMPTZ,
  hindsight_memory_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  source_document_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  CONSTRAINT memory_experience_projections_memory_fkey
    FOREIGN KEY (project_id, memory_id)
    REFERENCES tasklattice.memories(project_id, id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT memory_experience_actions_array_check
    CHECK (jsonb_typeof(actions) = 'array'),
  CONSTRAINT memory_experience_version_check CHECK (version > 0),
  CONSTRAINT memory_experience_occurred_range_check
    CHECK (occurred_start IS NULL OR occurred_end IS NULL OR occurred_start <= occurred_end)
);

CREATE INDEX memory_experience_projection_time_idx
  ON tasklattice.memory_experience_projections(project_id, memory_id, occurred_start DESC);

CREATE INDEX memory_experience_projection_status_idx
  ON tasklattice.memory_experience_projections(project_id, memory_id, status, updated_at DESC);
