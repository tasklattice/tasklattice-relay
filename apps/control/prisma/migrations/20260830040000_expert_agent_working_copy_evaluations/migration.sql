CREATE TABLE "tasklattice"."expert_agent_working_copy_evaluation_runs" (
  "project_id" TEXT NOT NULL,
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agent_id" UUID NOT NULL,
  "working_copy_id" UUID NOT NULL,
  "working_copy_revision" INTEGER NOT NULL,
  "content_digest" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "failure_reason" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "finished_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "expert_agent_working_copy_evaluation_runs_pkey"
    PRIMARY KEY ("project_id", "id"),
  CONSTRAINT "expert_agent_working_copy_evaluations_agent_fkey"
    FOREIGN KEY ("project_id", "agent_id")
    REFERENCES "tasklattice"."expert_agents"("project_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "expert_agent_working_copy_evaluations_working_copy_fkey"
    FOREIGN KEY ("project_id", "working_copy_id")
    REFERENCES "tasklattice"."expert_agent_working_copies"("project_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "expert_agent_working_copy_evaluations_status_check"
    CHECK ("status" IN ('PASSED', 'FAILED', 'CANCELLED')),
  CONSTRAINT "expert_agent_working_copy_evaluations_attempt_check"
    CHECK ("attempt" > 0),
  CONSTRAINT "expert_agent_working_copy_evaluations_revision_check"
    CHECK ("working_copy_revision" >= 0)
);

CREATE UNIQUE INDEX "expert_agent_working_copy_evaluations_attempt_key"
  ON "tasklattice"."expert_agent_working_copy_evaluation_runs"
  ("project_id", "working_copy_id", "working_copy_revision", "attempt");

CREATE INDEX "expert_agent_working_copy_evaluations_agent_created_idx"
  ON "tasklattice"."expert_agent_working_copy_evaluation_runs"
  ("project_id", "agent_id", "created_at" DESC);
