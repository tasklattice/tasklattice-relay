ALTER TABLE tasklattice.agents
  ADD COLUMN creation_idempotency_key TEXT;

CREATE UNIQUE INDEX agents_project_owner_creation_idempotency_key
  ON tasklattice.agents(project_id, owner_user_id, creation_idempotency_key);

ALTER TABLE tasklattice.agents
  ADD CONSTRAINT agents_creation_idempotency_key_check
  CHECK (
    creation_idempotency_key IS NULL
    OR char_length(creation_idempotency_key) BETWEEN 1 AND 200
  );
