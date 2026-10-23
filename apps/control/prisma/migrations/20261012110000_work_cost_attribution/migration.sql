ALTER TABLE "tasklattice"."cost_attribution_mapping"
  ADD COLUMN "work_id" TEXT,
  ADD COLUMN "work_name" TEXT,
  ADD COLUMN "task_id" TEXT,
  ADD COLUMN "task_name" TEXT,
  ADD COLUMN "work_run_id" TEXT;
ALTER TABLE "tasklattice"."model_usage_fact"
  ADD COLUMN "work_id" TEXT,
  ADD COLUMN "work_name" TEXT,
  ADD COLUMN "task_id" TEXT,
  ADD COLUMN "task_name" TEXT,
  ADD COLUMN "work_run_id" TEXT;
CREATE INDEX "model_usage_fact_work_task_time_idx" ON "tasklattice"."model_usage_fact" ("project_id", "work_id", "task_id", "request_start_time");
CREATE INDEX "model_usage_fact_work_run_idx" ON "tasklattice"."model_usage_fact" ("project_id", "work_run_id");
