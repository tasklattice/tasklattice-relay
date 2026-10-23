CREATE TABLE tasklattice.works (
 project_id text NOT NULL REFERENCES tasklattice.projects(id) ON DELETE CASCADE,
 id uuid NOT NULL, creation_key text NOT NULL, created_by text NOT NULL,
 revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0), state jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,id), UNIQUE(project_id,created_by,creation_key)
);
CREATE TABLE tasklattice.work_messages (
 project_id text NOT NULL, work_id uuid NOT NULL, id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('human','agent')),
 user_id text, instance_id text, name text NOT NULL, text text NOT NULL, source text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(project_id,work_id,id),
 FOREIGN KEY(project_id,work_id) REFERENCES tasklattice.works(project_id,id) ON DELETE CASCADE,
 CHECK ((kind='human' AND user_id IS NOT NULL AND instance_id IS NULL) OR (kind='agent' AND user_id IS NULL AND instance_id IS NOT NULL))
);
CREATE INDEX work_messages_created ON tasklattice.work_messages(project_id,work_id,created_at);
CREATE TABLE tasklattice.work_events (
 project_id text NOT NULL, work_id uuid NOT NULL, sequence integer NOT NULL,
 command_key text NOT NULL, command_hash text NOT NULL, type text NOT NULL,
 summary text NOT NULL, actor_id text NOT NULL, details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(project_id,work_id,sequence),
 UNIQUE(project_id,work_id,command_key),
 FOREIGN KEY(project_id,work_id) REFERENCES tasklattice.works(project_id,id) ON DELETE CASCADE
);
CREATE TABLE tasklattice.work_runs (
 id uuid PRIMARY KEY, project_id text NOT NULL, work_id uuid NOT NULL,
 task_id text, instance_id text NOT NULL, requested_by text NOT NULL, kind text NOT NULL,
 status text NOT NULL DEFAULT 'queued', reason text, input jsonb NOT NULL,
 approved_hash text NOT NULL, approval_expires_at timestamptz NOT NULL,
 plan_revision integer NOT NULL, fence integer NOT NULL DEFAULT 0,
 lease_until timestamptz, started_at timestamptz, finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,work_id) REFERENCES tasklattice.works(project_id,id) ON DELETE CASCADE
);
CREATE INDEX work_runs_due ON tasklattice.work_runs(status,created_at);
