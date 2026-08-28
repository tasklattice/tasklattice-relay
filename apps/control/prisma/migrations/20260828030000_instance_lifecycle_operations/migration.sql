CREATE TABLE tasklattice.instance_lifecycle_operations (
  project_id TEXT NOT NULL,
  id UUID NOT NULL,
  instance_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  current_message TEXT NOT NULL,
  error_code TEXT,
  error_summary TEXT,
  queue_job_id UUID,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ(6),
  finished_at TIMESTAMPTZ(6),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT instance_lifecycle_operations_pkey PRIMARY KEY (project_id, id),
  CONSTRAINT instance_lifecycle_operations_project_fkey
    FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON DELETE CASCADE,
  CONSTRAINT instance_lifecycle_operations_instance_fkey
    FOREIGN KEY (project_id, instance_id) REFERENCES tasklattice.agents(project_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX instance_lifecycle_operations_queue_job_id_key
  ON tasklattice.instance_lifecycle_operations(queue_job_id);
CREATE INDEX instance_lifecycle_operations_instance_idx
  ON tasklattice.instance_lifecycle_operations(project_id, instance_id, created_at DESC);
CREATE INDEX instance_lifecycle_operations_status_idx
  ON tasklattice.instance_lifecycle_operations(project_id, status, updated_at DESC);

CREATE TABLE tasklattice.instance_lifecycle_events (
  project_id TEXT NOT NULL,
  operation_id UUID NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  level TEXT NOT NULL,
  stage TEXT,
  message TEXT NOT NULL,
  payload JSONB,
  occurred_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT instance_lifecycle_events_pkey PRIMARY KEY (project_id, operation_id, sequence),
  CONSTRAINT instance_lifecycle_events_project_fkey
    FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON DELETE CASCADE,
  CONSTRAINT instance_lifecycle_events_operation_fkey
    FOREIGN KEY (project_id, operation_id)
    REFERENCES tasklattice.instance_lifecycle_operations(project_id, id) ON DELETE CASCADE
);

CREATE INDEX instance_lifecycle_events_occurred_idx
  ON tasklattice.instance_lifecycle_events(project_id, occurred_at DESC);

INSERT INTO tasklattice.instance_lifecycle_operations (
  project_id,
  id,
  instance_id,
  action,
  status,
  stage,
  progress,
  current_message,
  revision,
  created_at,
  started_at,
  finished_at,
  updated_at
)
SELECT
  agent.project_id,
  gen_random_uuid(),
  agent.id,
  'provision',
  CASE agent.payload->>'status'
    WHEN 'READY' THEN 'succeeded'
    WHEN 'FAILED' THEN 'failed'
    ELSE 'running'
  END,
  agent.payload->>'provisioningStage',
  CASE agent.payload->>'status'
    WHEN 'READY' THEN 100
    WHEN 'FAILED' THEN 100
    ELSE 8
  END,
  CASE agent.payload->>'status'
    WHEN 'READY' THEN 'Instance provisioning completed.'
    WHEN 'FAILED' THEN COALESCE(agent.payload->>'error', 'Instance provisioning failed.')
    ELSE 'Instance provisioning is continuing.'
  END,
  1,
  agent.created_at,
  agent.created_at,
  CASE WHEN agent.payload->>'status' IN ('READY', 'FAILED') THEN agent.updated_at ELSE NULL END,
  agent.updated_at
FROM tasklattice.agents AS agent
WHERE agent.kind = 'SUPERVISOR';

INSERT INTO tasklattice.instance_lifecycle_events (
  project_id,
  operation_id,
  sequence,
  type,
  level,
  stage,
  message,
  occurred_at
)
SELECT
  operation.project_id,
  operation.id,
  1,
  'snapshot',
  CASE operation.status WHEN 'failed' THEN 'error' ELSE 'info' END,
  operation.stage,
  operation.current_message,
  operation.updated_at
FROM tasklattice.instance_lifecycle_operations AS operation;
