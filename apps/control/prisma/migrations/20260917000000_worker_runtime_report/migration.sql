ALTER TABLE "tasklattice"."platform_settings" ADD COLUMN "worker_runtime" JSONB;
ALTER TABLE "tasklattice"."project_runtime_targets" DROP CONSTRAINT "project_runtime_targets_status_check";
ALTER TABLE "tasklattice"."project_runtime_targets" ADD CONSTRAINT "project_runtime_targets_status_check"
  CHECK (status IN ('pending', 'reconciling', 'ready', 'retry', 'failed', 'deleting'));
CREATE TABLE "tasklattice"."resource_operations" (
  id UUID PRIMARY KEY, project_id TEXT NOT NULL REFERENCES tasklattice.projects(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL, action TEXT NOT NULL, input_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', result JSONB, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX resource_operations_project_status_idx ON tasklattice.resource_operations(project_id, status);
