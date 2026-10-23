CREATE OR REPLACE FUNCTION tasklattice.validate_agent_instance_version_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  referenced_agent_id UUID;
  referenced_snapshot JSONB;
BEGIN
  IF NEW.kind NOT IN ('PROJECT_AGENT', 'WORK_AGENT') THEN
    IF NEW.developed_agent_id IS NOT NULL OR NEW.agent_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only versioned Agent Instances may reference a developed Agent Version';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.developed_agent_id IS NULL OR NEW.agent_version_id IS NULL THEN
    RAISE EXCEPTION 'Versioned Instances require an Agent and Version';
  END IF;
  SELECT agent_id, snapshot INTO referenced_agent_id, referenced_snapshot
    FROM tasklattice.expert_agent_versions
    WHERE project_id = NEW.project_id AND id = NEW.agent_version_id;
  IF referenced_agent_id IS DISTINCT FROM NEW.developed_agent_id THEN
    RAISE EXCEPTION 'Instance Version belongs to another Agent';
  END IF;
  IF NEW.kind = 'WORK_AGENT' AND (
    referenced_snapshot #>> '{execution,configuration,engineType}' IS DISTINCT FROM 'WORK_TEXT'
    OR NEW.payload->>'runtime' IS DISTINCT FROM 'work-worker'
    OR NEW.payload->>'role' IS DISTINCT FROM referenced_snapshot #>> '{execution,configuration,workRole}'
  ) THEN
    RAISE EXCEPTION 'Work Instances require the version-pinned Work text engine and role';
  END IF;
  RETURN NEW;
END;
$$;
