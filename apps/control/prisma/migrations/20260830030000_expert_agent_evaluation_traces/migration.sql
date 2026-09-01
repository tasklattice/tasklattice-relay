ALTER TABLE "tasklattice"."project_runs"
  DROP CONSTRAINT "project_runs_agent_platform_check",
  ADD CONSTRAINT "project_runs_agent_platform_check"
    CHECK ("agent_platform" IN ('openclaw', 'hermes', 'expert-agent'));

ALTER TABLE "tasklattice"."project_runs"
  DROP CONSTRAINT "project_runs_source_check",
  ADD CONSTRAINT "project_runs_source_check"
    CHECK ("source" IN ('openclaw', 'hermes', 'expert-agent', 'expert-agent-evaluation'));

ALTER TABLE "tasklattice"."project_runs"
  DROP CONSTRAINT "project_runs_trigger_type_check",
  ADD CONSTRAINT "project_runs_trigger_type_check"
    CHECK ("trigger_type" IN ('USER', 'SCHEDULED', 'DELEGATION', 'API', 'EVALUATION', 'UNKNOWN'));
