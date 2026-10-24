CREATE TABLE tasklattice.agent_ui_sessions (
    id TEXT PRIMARY KEY,
    credential_hash TEXT NOT NULL,
    auth_session_id TEXT NOT NULL REFERENCES tasklattice.auth_sessions(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    sandbox_name TEXT NOT NULL,
    generation TEXT NOT NULL,
    namespace TEXT NOT NULL,
    platform TEXT NOT NULL,
    upstream_origin TEXT NOT NULL,
    upstream_secret TEXT NOT NULL,
    expires_at TIMESTAMPTZ(6) NOT NULL,
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX agent_ui_sessions_expires_at_idx ON tasklattice.agent_ui_sessions(expires_at);
CREATE INDEX agent_ui_sessions_auth_session_id_idx ON tasklattice.agent_ui_sessions(auth_session_id);
