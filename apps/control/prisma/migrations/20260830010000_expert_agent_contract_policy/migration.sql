ALTER TABLE tasklattice.expert_agent_working_copies
  ADD COLUMN policy_spec JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tasklattice.expert_agent_working_copies.policy_spec IS
  'Independent Agent control dimensions. UI presets seed this object but do not define an exclusive Agent type.';
