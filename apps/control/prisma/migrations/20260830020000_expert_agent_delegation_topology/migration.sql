ALTER TABLE "tasklattice"."expert_agent_working_copies"
ADD COLUMN "delegation_spec" JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "tasklattice"."expert_agent_working_copies"."delegation_spec" IS
'Mutable, versioned Expert Agent relationships. Supervisor behavior is derived when one or more enabled relationships exist.';
