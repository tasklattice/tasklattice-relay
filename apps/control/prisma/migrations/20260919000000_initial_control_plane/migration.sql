-- Initial Relay schema and built-in seed data, including Worker resource operations.
-- Fresh-database baseline; no upgrade path from earlier development migrations.
-- Development Project: name = proj1, ID = tp-v3i65n4c7jslo (also its runtime Namespace).

CREATE SCHEMA IF NOT EXISTS tasklattice;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TYPE tasklattice.access_context_level AS ENUM (
    'PLATFORM',
    'DEPARTMENT',
    'PROJECT'
);

CREATE TYPE tasklattice.authorization_role_family AS ENUM (
    'ADMINISTRATION',
    'PROJECT_BUSINESS'
);

CREATE TYPE tasklattice.authorization_scope AS ENUM (
    'PLATFORM',
    'DEPARTMENT',
    'PROJECT'
);

CREATE TYPE tasklattice.department_role AS ENUM (
    'administrator',
    'member'
);

CREATE TYPE tasklattice.expert_agent_execution_mode AS ENUM (
    'AGENTIC',
    'WORKFLOW'
);

CREATE TYPE tasklattice.expert_agent_relation AS ENUM (
    'OWNER',
    'MAINTAINER'
);

CREATE TYPE tasklattice.external_identity_subject_type AS ENUM (
    'GROUP',
    'CLIENT'
);

CREATE TYPE tasklattice.external_role_scope AS ENUM (
    'PLATFORM',
    'DEPARTMENT',
    'PROJECT'
);

CREATE TYPE tasklattice.mcp_discovery_status AS ENUM (
    'HEALTHY',
    'PERMISSION_REQUIRED',
    'UNCHECKED',
    'UNAVAILABLE'
);

CREATE TYPE tasklattice.memory_binding_kind AS ENUM (
    'primary'
);

CREATE TYPE tasklattice.memory_binding_status AS ENUM (
    'pending',
    'active',
    'detached'
);

CREATE TYPE tasklattice.memory_experience_status AS ENUM (
    'active',
    'invalidated'
);

CREATE TYPE tasklattice.memory_outbox_status AS ENUM (
    'pending',
    'processing',
    'retry',
    'delivered',
    'dead_letter'
);

CREATE TYPE tasklattice.memory_runtime_type AS ENUM (
    'openclaw',
    'hermes'
);

CREATE TYPE tasklattice.memory_status AS ENUM (
    'provisioning',
    'ready',
    'degraded',
    'unbound',
    'deleting',
    'deletion_failed',
    'deleted'
);

CREATE TYPE tasklattice.project_role AS ENUM (
    'admin',
    'auditor',
    'developer',
    'user',
    'reviewer'
);

CREATE TYPE tasklattice.system_role AS ENUM (
    'user',
    'platform_administrator'
);

CREATE TYPE tasklattice.user_status AS ENUM (
    'active',
    'disabled'
);

CREATE FUNCTION tasklattice.prevent_project_name_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'Project names are immutable after creation.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tasklattice.reject_agent_version_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; release a new Version instead', TG_TABLE_NAME;
END;
$$;

CREATE FUNCTION tasklattice.validate_agent_instance_version_reference() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  referenced_agent_id UUID;
BEGIN
  IF NEW.kind <> 'PROJECT_AGENT' THEN
    IF NEW.developed_agent_id IS NOT NULL OR NEW.agent_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only PROJECT_AGENT Instances may reference a developed Agent Version';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.developed_agent_id IS NULL OR NEW.agent_version_id IS NULL THEN
    RAISE EXCEPTION 'PROJECT_AGENT Instances require an Agent and Version';
  END IF;
  SELECT agent_id INTO referenced_agent_id
    FROM tasklattice.expert_agent_versions
    WHERE project_id = NEW.project_id AND id = NEW.agent_version_id;
  IF referenced_agent_id IS DISTINCT FROM NEW.developed_agent_id THEN
    RAISE EXCEPTION 'Instance Version belongs to another Agent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tasklattice.validate_agent_release_reference() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  referenced_agent_id UUID;
BEGIN
  IF NEW.latest_released_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT agent_id INTO referenced_agent_id
    FROM tasklattice.expert_agent_versions
    WHERE project_id = NEW.project_id AND id = NEW.latest_released_version_id;
  IF referenced_agent_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Latest released Version belongs to another Agent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE tasklattice.access_context_sessions (
    session_id text NOT NULL,
    level tasklattice.access_context_level NOT NULL,
    resource_id text,
    role_id text NOT NULL,
    selected_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT access_context_sessions_scope_check CHECK ((((level = 'PLATFORM'::tasklattice.access_context_level) AND (resource_id IS NULL) AND (role_id = 'ROLE_PLATFORM_ADMIN'::text)) OR ((level = 'DEPARTMENT'::tasklattice.access_context_level) AND (resource_id IS NOT NULL) AND (role_id = 'ROLE_DEPARTMENT_ADMIN'::text)) OR ((level = 'PROJECT'::tasklattice.access_context_level) AND (resource_id IS NOT NULL) AND (role_id = ANY (ARRAY['ROLE_PROJECT_ADMIN'::text, 'ROLE_AUDITOR'::text, 'ROLE_AGENT_DEVELOPER'::text, 'ROLE_USER'::text, 'ROLE_REVIEWER'::text])))))
);

CREATE TABLE tasklattice.access_policies (
    project_id text NOT NULL,
    id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp(6) with time zone NOT NULL,
    updated_at timestamp(6) with time zone NOT NULL,
    deleted_at timestamp(6) with time zone
);

CREATE TABLE tasklattice.access_policy_versions (
    project_id text NOT NULL,
    policy_id text NOT NULL,
    revision integer NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp(6) with time zone NOT NULL
);

CREATE TABLE tasklattice.agent_catalog (
    project_id text NOT NULL,
    id text NOT NULL,
    payload jsonb NOT NULL,
    owner_user_id text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp(6) with time zone,
    CONSTRAINT agent_catalog_owner_kind_check CHECK (((((payload ->> 'source'::text) = 'BUILT_IN'::text) AND (owner_user_id IS NULL)) OR (((payload ->> 'source'::text) = 'PROJECT_REGISTERED'::text) AND (owner_user_id IS NOT NULL))))
);

CREATE TABLE tasklattice.agent_instance_access_policy_bindings (
    project_id text NOT NULL,
    instance_id text NOT NULL,
    access_policy_id text NOT NULL,
    bound_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    bound_by text NOT NULL
);

CREATE TABLE tasklattice.agent_specializations (
    project_id text NOT NULL,
    id text NOT NULL,
    payload jsonb NOT NULL,
    sort_order integer DEFAULT 1000 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp(6) with time zone
);

CREATE TABLE tasklattice.agents (
    project_id text NOT NULL,
    id text NOT NULL,
    payload jsonb NOT NULL,
    owner_user_id text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    deleted_at timestamp(6) with time zone,
    kind text DEFAULT 'SUPERVISOR'::text NOT NULL,
    catalog_agent_id text,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    creation_idempotency_key text,
    created_by_user_id text,
    developed_agent_id uuid,
    agent_version_id uuid,
    CONSTRAINT agents_catalog_agent_shape_check CHECK ((((kind = 'SUPERVISOR'::text) AND (catalog_agent_id IS NULL)) OR ((kind = 'A2A'::text) AND (catalog_agent_id IS NOT NULL)) OR ((kind = 'PROJECT_AGENT'::text) AND (catalog_agent_id IS NULL)))),
    CONSTRAINT agents_creation_idempotency_key_check CHECK (((creation_idempotency_key IS NULL) OR ((char_length(creation_idempotency_key) >= 1) AND (char_length(creation_idempotency_key) <= 200)))),
    CONSTRAINT agents_kind_check CHECK ((kind = ANY (ARRAY['SUPERVISOR'::text, 'A2A'::text, 'PROJECT_AGENT'::text])))
);

CREATE TABLE tasklattice.audit_logs (
    project_id text,
    id text NOT NULL,
    occurred_at timestamp(6) with time zone NOT NULL,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    actor_name text NOT NULL,
    actor_email text,
    authorization_role text NOT NULL,
    authorization_decision text NOT NULL,
    action text NOT NULL,
    verb text NOT NULL,
    object_type text NOT NULL,
    object_id text NOT NULL,
    object_name text NOT NULL,
    outcome text NOT NULL,
    summary text NOT NULL,
    request_id text NOT NULL,
    http_method text NOT NULL,
    route text NOT NULL,
    ip_address text NOT NULL,
    user_agent text NOT NULL,
    parameters jsonb,
    request_body jsonb,
    metadata jsonb,
    trace_id text,
    span_id text,
    record_id text NOT NULL,
    authorization_capability text,
    authorization_reason text,
    CONSTRAINT audit_logs_actor_type_check CHECK ((actor_type = ANY (ARRAY['user'::text, 'service_account'::text, 'system'::text]))),
    CONSTRAINT audit_logs_authorization_decision_check CHECK ((authorization_decision = ANY (ARRAY['allowed'::text, 'denied'::text, 'approval_required'::text]))),
    CONSTRAINT audit_logs_outcome_check CHECK ((outcome = ANY (ARRAY['success'::text, 'failed'::text, 'denied'::text])))
);

CREATE TABLE tasklattice.auth_accounts (
    id text NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    issuer text NOT NULL,
    user_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp(6) with time zone,
    refresh_token_expires_at timestamp(6) with time zone,
    scope text,
    password text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE tasklattice.auth_sessions (
    id text NOT NULL,
    token text NOT NULL,
    expires_at timestamp(6) with time zone NOT NULL,
    ip_address text,
    user_agent text,
    user_id text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE tasklattice.auth_verifications (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp(6) with time zone NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE tasklattice.capability_definitions (
    id text NOT NULL,
    scope tasklattice.authorization_scope NOT NULL,
    side_effect boolean DEFAULT false NOT NULL,
    sensitive_content boolean DEFAULT false NOT NULL,
    system_managed boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE tasklattice.cost_attribution_mapping (
    project_id text NOT NULL,
    id text NOT NULL,
    instance_id text NOT NULL,
    instance_name text NOT NULL,
    litellm_virtual_key_id text,
    hashed_token text,
    virtual_key_alias text NOT NULL,
    litellm_user_id text,
    litellm_team_id text,
    provider_account_id text,
    valid_from timestamp with time zone NOT NULL,
    valid_to timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE tasklattice.cost_sync_checkpoint (
    project_id text NOT NULL,
    source text NOT NULL,
    cursor_value text,
    last_successful_end_time timestamp with time zone,
    last_sync_at timestamp with time zone,
    sync_lag_seconds integer,
    processed_records bigint DEFAULT 0 NOT NULL,
    failed_records bigint DEFAULT 0 NOT NULL,
    duplicate_records bigint DEFAULT 0 NOT NULL,
    late_arriving_records bigint DEFAULT 0 NOT NULL,
    source_spend_usd numeric(65,30) DEFAULT 0 NOT NULL
);

CREATE TABLE tasklattice.department_inference_resources (
    department_id text NOT NULL,
    id text NOT NULL,
    kind text NOT NULL,
    provider_account_id text,
    payload jsonb NOT NULL,
    credential_payload text,
    created_at timestamp(6) with time zone NOT NULL,
    deleted_at timestamp(6) with time zone,
    CONSTRAINT department_inference_resources_credential_check CHECK ((((kind = 'PROVIDER'::text) AND (credential_payload IS NOT NULL)) OR ((kind <> 'PROVIDER'::text) AND (credential_payload IS NULL)))),
    CONSTRAINT department_inference_resources_kind_check CHECK ((kind = ANY (ARRAY['PROVIDER'::text, 'MODEL'::text, 'GATEWAY'::text, 'ROUTING'::text])))
);

CREATE TABLE tasklattice.department_members (
    department_id text NOT NULL,
    user_id text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    joined_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    role tasklattice.department_role DEFAULT 'member'::tasklattice.department_role NOT NULL,
    manual_access boolean DEFAULT true NOT NULL,
    external_access_active boolean DEFAULT false NOT NULL,
    CONSTRAINT department_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
);

CREATE TABLE tasklattice.department_model_routing_audit (
    department_id text NOT NULL,
    event_id text NOT NULL,
    model_routing_id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp(6) with time zone NOT NULL
);

CREATE TABLE tasklattice.departments (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    hard_budget_usd numeric(18,6),
    status text DEFAULT 'active'::text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    default_chat_model text,
    default_embedding_model text,
    default_routing_mode text DEFAULT 'PROJECT_MANAGED'::text NOT NULL,
    default_fallback_model text,
    soft_budget_usd numeric(18,6),
    soft_max_instances integer,
    hard_max_instances integer,
    soft_max_mcp_integrations integer,
    hard_max_mcp_integrations integer,
    soft_max_knowledge_base_integrations integer,
    hard_max_knowledge_base_integrations integer,
    default_project_hard_budget_usd numeric(18,6),
    default_project_budget_duration text,
    default_project_tpm_limit bigint,
    default_project_max_instances integer,
    default_project_max_mcp_integrations integer,
    default_project_max_knowledge_base_integrations integer,
    settings_revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT departments_budget_check CHECK (((hard_budget_usd IS NULL) OR (hard_budget_usd >= (0)::numeric))),
    CONSTRAINT departments_default_project_budget_duration_check CHECK (((default_project_budget_duration IS NULL) OR (default_project_budget_duration = ANY (ARRAY['1d'::text, '7d'::text, '30d'::text])))),
    CONSTRAINT departments_default_routing_mode_check CHECK ((default_routing_mode = ANY (ARRAY['PROJECT_MANAGED'::text, 'SINGLE'::text, 'FAILOVER'::text]))),
    CONSTRAINT departments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
);

CREATE TABLE tasklattice.expert_agent_members (
    project_id text NOT NULL,
    agent_id uuid NOT NULL,
    user_id text NOT NULL,
    relation tasklattice.expert_agent_relation NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE tasklattice.expert_agent_test_runs (
    project_id text NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    agent_revision integer NOT NULL,
    content_digest text NOT NULL,
    mode text NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    status text NOT NULL,
    evidence jsonb NOT NULL,
    failure_reason text,
    created_by text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    started_at timestamp(6) with time zone NOT NULL,
    finished_at timestamp(6) with time zone NOT NULL,
    CONSTRAINT expert_agent_test_runs_attempt_check CHECK ((attempt > 0)),
    CONSTRAINT expert_agent_test_runs_digest_check CHECK ((content_digest ~ '^sha256:[a-f0-9]{64}$'::text)),
    CONSTRAINT expert_agent_test_runs_mode_check CHECK ((mode = ANY (ARRAY['QUICK'::text, 'RELEASE'::text]))),
    CONSTRAINT expert_agent_test_runs_revision_check CHECK ((agent_revision >= 0)),
    CONSTRAINT expert_agent_test_runs_status_check CHECK ((status = ANY (ARRAY['PASSED'::text, 'FAILED'::text, 'CANCELLED'::text]))),
    CONSTRAINT expert_agent_test_runs_time_check CHECK ((finished_at >= started_at))
);

CREATE TABLE tasklattice.expert_agent_version_artifacts (
    project_id text NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_id uuid NOT NULL,
    kind text NOT NULL,
    media_type text NOT NULL,
    digest text NOT NULL,
    uri text NOT NULL,
    size_bytes integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expert_agent_version_artifacts_digest_check CHECK ((digest ~ '^sha256:[a-f0-9]{64}$'::text)),
    CONSTRAINT expert_agent_version_artifacts_size_check CHECK (((size_bytes IS NULL) OR (size_bytes >= 0)))
);

CREATE TABLE tasklattice.expert_agent_versions (
    project_id text NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    version_number integer NOT NULL,
    source_revision integer NOT NULL,
    content_digest text NOT NULL,
    snapshot jsonb NOT NULL,
    manifest jsonb NOT NULL,
    manifest_digest text NOT NULL,
    artifact_set_digest text NOT NULL,
    release_notes text,
    garden_status text DEFAULT 'PUBLISHED'::text NOT NULL,
    published_by text NOT NULL,
    published_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expert_agent_versions_artifact_set_digest_check CHECK ((artifact_set_digest ~ '^sha256:[a-f0-9]{64}$'::text)),
    CONSTRAINT expert_agent_versions_digest_check CHECK ((content_digest ~ '^sha256:[a-f0-9]{64}$'::text)),
    CONSTRAINT expert_agent_versions_garden_status_check CHECK ((garden_status = ANY (ARRAY['PUBLISHED'::text, 'WITHDRAWN'::text]))),
    CONSTRAINT expert_agent_versions_manifest_digest_check CHECK ((manifest_digest ~ '^sha256:[a-f0-9]{64}$'::text)),
    CONSTRAINT expert_agent_versions_number_check CHECK ((version_number > 0)),
    CONSTRAINT expert_agent_versions_revision_check CHECK ((source_revision >= 0))
);

CREATE TABLE tasklattice.expert_agents (
    project_id text NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    execution_mode tasklattice.expert_agent_execution_mode NOT NULL,
    created_by text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp(6) with time zone,
    revision integer DEFAULT 0 NOT NULL,
    content_digest text NOT NULL,
    product_spec jsonb NOT NULL,
    policy_spec jsonb NOT NULL,
    delegation_spec jsonb DEFAULT '[]'::jsonb NOT NULL,
    acceptance_spec jsonb NOT NULL,
    safety_spec jsonb NOT NULL,
    execution_spec jsonb NOT NULL,
    resource_bindings jsonb DEFAULT '[]'::jsonb NOT NULL,
    latest_released_version_id uuid,
    updated_by text NOT NULL,
    CONSTRAINT expert_agents_digest_check CHECK ((content_digest ~ '^sha256:[a-f0-9]{64}$'::text)),
    CONSTRAINT expert_agents_revision_check CHECK ((revision >= 0)),
    CONSTRAINT expert_agents_slug_check CHECK ((slug ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'::text))
);

CREATE TABLE tasklattice.external_role_bindings (
    id text NOT NULL,
    provider_id text DEFAULT 'corporate-sso'::text NOT NULL,
    subject_type tasklattice.external_identity_subject_type DEFAULT 'GROUP'::tasklattice.external_identity_subject_type NOT NULL,
    subject_value text NOT NULL,
    scope tasklattice.external_role_scope NOT NULL,
    department_id text,
    project_id text,
    role_id text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_by text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT external_role_bindings_scope_check CHECK ((((scope = 'PLATFORM'::tasklattice.external_role_scope) AND (department_id IS NULL) AND (project_id IS NULL) AND (role_id = 'ROLE_PLATFORM_ADMIN'::text)) OR ((scope = 'DEPARTMENT'::tasklattice.external_role_scope) AND (department_id IS NOT NULL) AND (project_id IS NULL) AND (role_id = ANY (ARRAY['ROLE_DEPARTMENT_ADMIN'::text, 'ROLE_DEPARTMENT_MEMBER'::text]))) OR ((scope = 'PROJECT'::tasklattice.external_role_scope) AND (department_id IS NOT NULL) AND (project_id IS NOT NULL) AND (role_id = ANY (ARRAY['ROLE_PROJECT_ADMIN'::text, 'ROLE_AUDITOR'::text, 'ROLE_AGENT_DEVELOPER'::text, 'ROLE_USER'::text, 'ROLE_REVIEWER'::text]))))),
    CONSTRAINT external_role_bindings_subject_path_check CHECK (((subject_type <> 'GROUP'::tasklattice.external_identity_subject_type) OR (subject_value =
CASE
    WHEN (scope = 'PLATFORM'::tasklattice.external_role_scope) THEN ('/tali/r/'::text || role_id)
    WHEN (scope = 'DEPARTMENT'::tasklattice.external_role_scope) THEN ((('/tali/d/'::text || department_id) || '/r/'::text) || role_id)
    WHEN (scope = 'PROJECT'::tasklattice.external_role_scope) THEN ((((('/tali/d/'::text || department_id) || '/p/'::text) || project_id) || '/r/'::text) || role_id)
    ELSE NULL::text
END)))
);

CREATE TABLE tasklattice.external_role_grants (
    binding_id text NOT NULL,
    user_id text NOT NULL,
    last_seen_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE tasklattice.inference_gateways (
    project_id text NOT NULL,
    id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE tasklattice.instance_lifecycle_events (
    project_id text NOT NULL,
    operation_id uuid NOT NULL,
    sequence integer NOT NULL,
    type text NOT NULL,
    level text NOT NULL,
    stage text,
    message text NOT NULL,
    payload jsonb,
    occurred_at timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE tasklattice.instance_lifecycle_operations (
    project_id text NOT NULL,
    id uuid NOT NULL,
    instance_id text NOT NULL,
    action text NOT NULL,
    status text NOT NULL,
    stage text,
    progress integer DEFAULT 0 NOT NULL,
    current_message text NOT NULL,
    error_code text,
    error_summary text,
    queue_job_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    started_at timestamp(6) with time zone,
    finished_at timestamp(6) with time zone,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL
);

CREATE TABLE tasklattice.knowledge_sources (
    project_id text NOT NULL,
    id text NOT NULL,
    payload jsonb NOT NULL,
    sort_order integer DEFAULT 1000 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp(6) with time zone
);

CREATE TABLE tasklattice.knowledge_vector_chunks (
    project_id text NOT NULL,
    database_id text NOT NULL,
    id text NOT NULL,
    content text NOT NULL,
    filename text NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    embedding_dimensions integer NOT NULL,
    embedding public.vector NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    document_id text,
    document_revision integer,
    page_number integer,
    chunk_index integer,
    token_count integer,
    section_path text[] DEFAULT ARRAY[]::text[] NOT NULL,
    label text,
    CONSTRAINT knowledge_vector_chunks_document_pair_check CHECK (((document_id IS NULL) = (document_revision IS NULL))),
    CONSTRAINT knowledge_vector_chunks_embedding_dimensions_check CHECK ((public.vector_dims(embedding) = embedding_dimensions)),
    CONSTRAINT knowledge_vector_chunks_index_check CHECK (((chunk_index IS NULL) OR (chunk_index >= 0))),
    CONSTRAINT knowledge_vector_chunks_page_check CHECK (((page_number IS NULL) OR (page_number > 0))),
    CONSTRAINT knowledge_vector_chunks_token_check CHECK (((token_count IS NULL) OR (token_count >= 0)))
);

CREATE TABLE tasklattice.knowledge_vector_databases (
    project_id text NOT NULL,
    id text NOT NULL,
    vector_store_id text NOT NULL,
    embedding_model text NOT NULL,
    embedding_dimensions integer NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT knowledge_vector_databases_dimensions_check CHECK (((embedding_dimensions >= 1) AND (embedding_dimensions <= 16000)))
);

CREATE TABLE tasklattice.mcp_servers (
    project_id text NOT NULL,
    id text NOT NULL,
    payload jsonb NOT NULL,
    sort_order integer DEFAULT 1000 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    discovery_status tasklattice.mcp_discovery_status DEFAULT 'UNCHECKED'::tasklattice.mcp_discovery_status NOT NULL,
    last_discovery_attempt_at timestamp(6) with time zone,
    last_discovered_at timestamp(6) with time zone,
    last_discovery_error text,
    litellm_server_id text NOT NULL,
    deleted_at timestamp(6) with time zone
);

CREATE TABLE tasklattice.mcp_tools (
    project_id text NOT NULL,
    mcp_server_id text NOT NULL,
    name text NOT NULL,
    title text,
    description text,
    input_schema jsonb NOT NULL,
    output_schema jsonb,
    annotations jsonb,
    discovered_at timestamp(6) with time zone NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE tasklattice.memories (
    project_id text NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name text NOT NULL,
    provider text DEFAULT 'hindsight'::text NOT NULL,
    provider_ref text,
    status tasklattice.memory_status DEFAULT 'provisioning'::tasklattice.memory_status NOT NULL,
    retention_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    idempotency_key text,
    last_activity_at timestamp with time zone,
    last_error_summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT memories_deleted_provider_ref_check CHECK (((status <> 'deleted'::tasklattice.memory_status) OR (provider_ref IS NULL))),
    CONSTRAINT memories_deleted_state_check CHECK (((status = 'deleted'::tasklattice.memory_status) = (deleted_at IS NOT NULL))),
    CONSTRAINT memories_display_name_check CHECK (((char_length(btrim(display_name)) >= 1) AND (char_length(btrim(display_name)) <= 120))),
    CONSTRAINT memories_retention_policy_object_check CHECK ((jsonb_typeof(retention_policy) = 'object'::text))
);

CREATE TABLE tasklattice.memory_bindings (
    project_id text NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    memory_id uuid NOT NULL,
    instance_id text NOT NULL,
    runtime_type tasklattice.memory_runtime_type NOT NULL,
    binding_kind tasklattice.memory_binding_kind DEFAULT 'primary'::tasklattice.memory_binding_kind NOT NULL,
    status tasklattice.memory_binding_status DEFAULT 'pending'::tasklattice.memory_binding_status NOT NULL,
    idempotency_key text NOT NULL,
    attached_at timestamp with time zone,
    detached_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT memory_bindings_lifecycle_time_check CHECK ((((status = 'pending'::tasklattice.memory_binding_status) AND (attached_at IS NULL) AND (detached_at IS NULL)) OR ((status = 'active'::tasklattice.memory_binding_status) AND (attached_at IS NOT NULL) AND (detached_at IS NULL)) OR ((status = 'detached'::tasklattice.memory_binding_status) AND (detached_at IS NOT NULL))))
);

CREATE TABLE tasklattice.memory_curation_events (
    project_id text NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    memory_id uuid NOT NULL,
    provider_item_id text NOT NULL,
    action text NOT NULL,
    before_snapshot jsonb,
    after_snapshot jsonb,
    actor_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE tasklattice.memory_experience_projections (
    project_id text NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    memory_id uuid NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    situation text NOT NULL,
    goal text NOT NULL,
    actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    outcome text NOT NULL,
    lesson_learned text NOT NULL,
    status tasklattice.memory_experience_status DEFAULT 'active'::tasklattice.memory_experience_status NOT NULL,
    occurred_start timestamp with time zone,
    occurred_end timestamp with time zone,
    hindsight_memory_ids text[] DEFAULT ARRAY[]::text[] NOT NULL,
    source_document_ids text[] DEFAULT ARRAY[]::text[] NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT memory_experience_actions_array_check CHECK ((jsonb_typeof(actions) = 'array'::text)),
    CONSTRAINT memory_experience_occurred_range_check CHECK (((occurred_start IS NULL) OR (occurred_end IS NULL) OR (occurred_start <= occurred_end))),
    CONSTRAINT memory_experience_version_check CHECK ((version > 0))
);

CREATE TABLE tasklattice.memory_outbox (
    project_id text NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    memory_id uuid NOT NULL,
    conversation_id text NOT NULL,
    event_type text NOT NULL,
    encrypted_payload text,
    payload_ref text,
    status tasklattice.memory_outbox_status DEFAULT 'pending'::tasklattice.memory_outbox_status NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error_summary text,
    idempotency_key text NOT NULL,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT memory_outbox_delivery_check CHECK ((((status = 'delivered'::tasklattice.memory_outbox_status) AND (delivered_at IS NOT NULL)) OR ((status <> 'delivered'::tasklattice.memory_outbox_status) AND (delivered_at IS NULL)))),
    CONSTRAINT memory_outbox_payload_check CHECK (((encrypted_payload IS NOT NULL) <> (payload_ref IS NOT NULL))),
    CONSTRAINT memory_outbox_retry_count_check CHECK ((retry_count >= 0))
);

CREATE TABLE tasklattice.model_deployments (
    project_id text NOT NULL,
    id text NOT NULL,
    provider_account_id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    deleted_at timestamp(6) with time zone
);

CREATE TABLE tasklattice.model_endpoint_mapping (
    project_id text NOT NULL,
    id text NOT NULL,
    model_endpoint_id text NOT NULL,
    model_endpoint_name text NOT NULL,
    litellm_model_name text,
    litellm_model_group text,
    litellm_model_id text,
    provider text NOT NULL,
    provider_account_id text NOT NULL,
    provider_account_name text NOT NULL,
    valid_from timestamp with time zone NOT NULL,
    valid_to timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE tasklattice.model_routing_audit (
    project_id text NOT NULL,
    event_id text NOT NULL,
    model_routing_id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE tasklattice.model_routing_bindings (
    project_id text NOT NULL,
    id text NOT NULL,
    model_routing_id text NOT NULL,
    agent_id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE tasklattice.model_routings (
    project_id text NOT NULL,
    id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    deleted_at timestamp(6) with time zone
);

CREATE TABLE tasklattice.model_usage_daily (
    project_id text NOT NULL,
    usage_date date NOT NULL,
    timezone text NOT NULL,
    group_type text NOT NULL,
    group_id text NOT NULL,
    group_name text NOT NULL,
    spend_usd numeric(65,30) NOT NULL,
    prompt_tokens bigint NOT NULL,
    completion_tokens bigint NOT NULL,
    total_tokens bigint NOT NULL,
    requests bigint NOT NULL,
    successful_requests bigint NOT NULL,
    failed_requests bigint NOT NULL,
    active_object_count integer NOT NULL,
    first_request_at timestamp with time zone NOT NULL,
    last_request_at timestamp with time zone NOT NULL
);

CREATE TABLE tasklattice.model_usage_fact (
    project_id text NOT NULL,
    event_id text NOT NULL,
    request_id text NOT NULL,
    request_start_time timestamp with time zone NOT NULL,
    first_token_time timestamp with time zone,
    response_end_time timestamp with time zone,
    usage_date date NOT NULL,
    usage_hour smallint NOT NULL,
    instance_id text,
    instance_name text,
    model_endpoint_id text,
    model_endpoint_name text,
    provider_account_id text,
    provider_account_name text,
    virtual_key_id text,
    virtual_key_alias text,
    litellm_user_id text,
    litellm_team_id text,
    organization_id text,
    end_user_id text,
    requested_model text NOT NULL,
    resolved_model text NOT NULL,
    model_group text NOT NULL,
    provider text NOT NULL,
    call_type text NOT NULL,
    prompt_tokens bigint NOT NULL,
    completion_tokens bigint NOT NULL,
    total_tokens bigint NOT NULL,
    cached_input_tokens bigint NOT NULL,
    cache_creation_input_tokens bigint NOT NULL,
    reasoning_tokens bigint NOT NULL,
    prompt_cost_usd numeric(65,30),
    completion_cost_usd numeric(65,30),
    total_cost_usd numeric(65,30),
    provider_reported_cost_usd numeric(65,30),
    litellm_calculated_cost_usd numeric(65,30),
    cost_status text NOT NULL,
    cost_source text NOT NULL,
    price_version text NOT NULL,
    success_count smallint NOT NULL,
    failure_count smallint NOT NULL,
    latency_ms integer,
    time_to_first_token_ms integer,
    http_status_code integer,
    error_type text,
    retry_count integer NOT NULL,
    cache_hit boolean NOT NULL,
    fallback_used boolean NOT NULL,
    status text NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_record_hash text NOT NULL,
    correction_of_event_id text,
    created_at timestamp with time zone NOT NULL,
    run_id text,
    trace_id text
);

CREATE TABLE tasklattice.model_usage_fact_observation (
    id bigint NOT NULL,
    project_id text NOT NULL,
    event_id text NOT NULL,
    request_id text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    reason text NOT NULL,
    source_record_hash text NOT NULL,
    payload jsonb NOT NULL
);

CREATE SEQUENCE tasklattice.model_usage_fact_observation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE tasklattice.model_usage_fact_observation_id_seq OWNED BY tasklattice.model_usage_fact_observation.id;

CREATE TABLE tasklattice.platform_settings (
    id text DEFAULT 'platform'::text NOT NULL,
    enabled_provider_kinds jsonb,
    revision integer DEFAULT 1 NOT NULL,
    updated_by text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    oidc_enabled boolean DEFAULT false NOT NULL,
    oidc_display_name text DEFAULT 'SSO'::text NOT NULL,
    oidc_issuer text DEFAULT ''::text NOT NULL,
    oidc_client_id text DEFAULT ''::text NOT NULL,
    oidc_client_secret_encrypted text,
    smtp_enabled boolean DEFAULT false NOT NULL,
    smtp_host text DEFAULT ''::text NOT NULL,
    smtp_port integer DEFAULT 587 NOT NULL,
    smtp_secure boolean DEFAULT false NOT NULL,
    smtp_username text DEFAULT ''::text NOT NULL,
    smtp_password_encrypted text,
    smtp_from_address text DEFAULT ''::text NOT NULL,
    smtp_from_name text DEFAULT 'TaskLattice Relay'::text NOT NULL,
    smtp_reply_to text DEFAULT ''::text NOT NULL,
    runtime_namespace_deletion_timeout_seconds integer DEFAULT 120 NOT NULL,
    sandbox_cpu text,
    sandbox_memory text,
    oidc_group_claim text DEFAULT 'groups'::text NOT NULL,
    control_internal_url text,
    runner_url text,
    runner_token_encrypted text,
    litellm_url text,
    litellm_master_key_encrypted text,
    runtime_namespaces_enabled boolean,
    runtime_cluster_id text,
    local_authentication_enabled boolean,
    runtime_images jsonb,
    worker_runtime jsonb,
    CONSTRAINT platform_settings_runtime_deletion_timeout_check CHECK (((runtime_namespace_deletion_timeout_seconds >= 10) AND (runtime_namespace_deletion_timeout_seconds <= 1800))),
    CONSTRAINT platform_settings_singleton_check CHECK ((id = 'platform'::text)),
    CONSTRAINT platform_settings_smtp_port_check CHECK (((smtp_port >= 1) AND (smtp_port <= 65535)))
);

CREATE TABLE tasklattice.project_deletion_tasks (
    project_id text NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    scheduled_for timestamp(6) with time zone NOT NULL,
    next_attempt_at timestamp(6) with time zone NOT NULL,
    lease_owner text,
    lease_expires_at timestamp(6) with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    queue_job_id uuid,
    CONSTRAINT project_deletion_tasks_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT project_deletion_tasks_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'running'::text, 'retry'::text, 'completed'::text, 'failed'::text])))
);

CREATE TABLE tasklattice.project_department_models (
    project_id text NOT NULL,
    department_id text NOT NULL,
    resource_id text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    project_inherited_at timestamp(6) with time zone,
    project_inherited_by text,
    department_assigned_at timestamp(6) with time zone,
    department_assigned_by text,
    default_for text,
    default_managed_by text,
    CONSTRAINT project_department_models_default_for_check CHECK (((default_for IS NULL) OR (default_for = ANY (ARRAY['CHAT'::text, 'EMBEDDING'::text, 'SPEECH_TO_TEXT'::text])))),
    CONSTRAINT project_department_models_default_manager_check CHECK ((((default_for IS NULL) AND (default_managed_by IS NULL)) OR ((default_for IS NOT NULL) AND (default_managed_by = ANY (ARRAY['PROJECT'::text, 'DEPARTMENT'::text]))))),
    CONSTRAINT project_department_models_source_check CHECK (((project_inherited_at IS NOT NULL) OR (department_assigned_at IS NOT NULL)))
);

CREATE TABLE tasklattice.project_department_routings (
    project_id text NOT NULL,
    department_id text NOT NULL,
    resource_id text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    litellm_team_id text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    project_inherited_at timestamp(6) with time zone,
    project_inherited_by text,
    department_assigned_at timestamp(6) with time zone,
    department_assigned_by text,
    default_managed_by text,
    CONSTRAINT project_department_routings_default_manager_check CHECK ((((is_default = false) AND (default_managed_by IS NULL)) OR ((is_default = true) AND (default_managed_by = ANY (ARRAY['PROJECT'::text, 'DEPARTMENT'::text]))))),
    CONSTRAINT project_department_routings_source_check CHECK (((project_inherited_at IS NOT NULL) OR (department_assigned_at IS NOT NULL)))
);

CREATE TABLE tasklattice.project_invitations (
    id text NOT NULL,
    project_id text NOT NULL,
    email text NOT NULL,
    role tasklattice.project_role NOT NULL,
    invited_by text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text])))
);

CREATE TABLE tasklattice.project_member_role_assignments (
    project_id text NOT NULL,
    user_id text NOT NULL,
    role tasklattice.project_role NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    manual_assignment boolean DEFAULT true NOT NULL,
    external_assignment_active boolean DEFAULT false NOT NULL
);

CREATE TABLE tasklattice.project_members (
    project_id text NOT NULL,
    user_id text NOT NULL,
    role tasklattice.project_role NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    manual_access boolean DEFAULT true NOT NULL,
    external_access_active boolean DEFAULT false NOT NULL
);

CREATE TABLE tasklattice.project_quotas (
    project_id text NOT NULL,
    hard_budget_usd numeric(18,6),
    budget_duration text,
    tpm_limit bigint,
    max_instances integer,
    max_mcp_integrations integer,
    max_knowledge_base_integrations integer,
    litellm_team_id text,
    sync_status text DEFAULT 'pending'::text NOT NULL,
    last_synced_at timestamp(6) with time zone,
    last_sync_error text,
    updated_by text,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    budget_period_started_at timestamp(6) with time zone,
    budget_resets_at timestamp(6) with time zone,
    CONSTRAINT project_quotas_budget_window_check CHECK ((((hard_budget_usd IS NULL) AND (budget_duration IS NULL) AND (budget_period_started_at IS NULL) AND (budget_resets_at IS NULL)) OR ((hard_budget_usd IS NOT NULL) AND (budget_duration = ANY (ARRAY['1d'::text, '7d'::text, '30d'::text])) AND (budget_period_started_at IS NOT NULL) AND (budget_resets_at IS NOT NULL) AND (budget_resets_at > budget_period_started_at)))),
    CONSTRAINT project_quotas_non_negative CHECK ((((hard_budget_usd IS NULL) OR (hard_budget_usd >= (0)::numeric)) AND ((tpm_limit IS NULL) OR (tpm_limit >= 0)) AND ((max_instances IS NULL) OR (max_instances >= 0)) AND ((max_mcp_integrations IS NULL) OR (max_mcp_integrations >= 0)) AND ((max_knowledge_base_integrations IS NULL) OR (max_knowledge_base_integrations >= 0))))
);

CREATE TABLE tasklattice.project_runs (
    project_id text NOT NULL,
    id text NOT NULL,
    instance_id text NOT NULL,
    agent_platform text NOT NULL,
    source text NOT NULL,
    external_run_id text NOT NULL,
    trigger_type text NOT NULL,
    status text NOT NULL,
    trace_id text,
    started_at timestamp(6) with time zone NOT NULL,
    ended_at timestamp(6) with time zone,
    duration_ms integer,
    terminal_reason text,
    error_category text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expert_agent_id uuid,
    expert_agent_version_id uuid,
    expert_engine_version text,
    expert_trace jsonb,
    CONSTRAINT project_runs_agent_platform_check CHECK ((agent_platform = ANY (ARRAY['openclaw'::text, 'hermes'::text, 'expert-agent'::text]))),
    CONSTRAINT project_runs_duration_check CHECK (((duration_ms IS NULL) OR (duration_ms >= 0))),
    CONSTRAINT project_runs_source_check CHECK ((source = ANY (ARRAY['openclaw'::text, 'hermes'::text, 'expert-agent'::text, 'expert-agent-evaluation'::text]))),
    CONSTRAINT project_runs_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'TIMED_OUT'::text, 'CANCELLED'::text, 'BLOCKED'::text]))),
    CONSTRAINT project_runs_terminal_time_check CHECK ((((status = 'RUNNING'::text) AND (ended_at IS NULL)) OR ((status <> 'RUNNING'::text) AND (ended_at IS NOT NULL)))),
    CONSTRAINT project_runs_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['USER'::text, 'SCHEDULED'::text, 'DELEGATION'::text, 'API'::text, 'EVALUATION'::text, 'UNKNOWN'::text])))
);

CREATE TABLE tasklattice.project_runtime_targets (
    project_id text NOT NULL,
    cluster_id text NOT NULL,
    namespace text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    generation integer DEFAULT 1 NOT NULL,
    observed_generation integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    lease_owner text,
    lease_expires_at timestamp(6) with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    last_reconciled_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT project_runtime_targets_generation_check CHECK (((generation >= 1) AND (observed_generation >= 0) AND (observed_generation <= generation))),
    CONSTRAINT project_runtime_targets_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reconciling'::text, 'ready'::text, 'retry'::text, 'failed'::text, 'deleting'::text])))
);

CREATE TABLE tasklattice.projects (
    id text NOT NULL,
    name text NOT NULL,
    avatar text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp(6) with time zone,
    deleted_by text,
    department_id text NOT NULL,
    inherited_department_defaults jsonb,
    inherited_department_settings_revision integer
);

CREATE TABLE tasklattice.provider_accounts (
    project_id text NOT NULL,
    id text NOT NULL,
    payload jsonb NOT NULL,
    credential_payload text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    deleted_at timestamp(6) with time zone
);

CREATE TABLE tasklattice.role_capability_grants (
    role_id text NOT NULL,
    capability_id text NOT NULL,
    relations jsonb NOT NULL,
    CONSTRAINT role_capability_grants_relations_array_check CHECK ((jsonb_typeof(relations) = 'array'::text))
);

CREATE TABLE tasklattice.role_catalog_state (
    id text DEFAULT 'builtin'::text NOT NULL,
    revision integer NOT NULL,
    synced_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE tasklattice.role_definitions (
    id text NOT NULL,
    scope tasklattice.authorization_scope NOT NULL,
    family tasklattice.authorization_role_family NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    builtin boolean DEFAULT true NOT NULL,
    assignable boolean DEFAULT true NOT NULL,
    system_managed boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE tasklattice.sandbox_policies (
    project_id text NOT NULL,
    id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    deleted_at timestamp(6) with time zone
);

CREATE TABLE tasklattice.skill_artifacts (
    id text NOT NULL,
    skill_id text NOT NULL,
    version text NOT NULL,
    digest text NOT NULL,
    archive_format text NOT NULL,
    content_type text NOT NULL,
    archive bytea NOT NULL,
    compressed_size_bytes integer NOT NULL,
    unpacked_size_bytes integer NOT NULL,
    file_count integer NOT NULL,
    manifest jsonb NOT NULL,
    source_path text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT skill_artifacts_archive_format_check CHECK ((archive_format = 'tar+gzip'::text)),
    CONSTRAINT skill_artifacts_file_count_check CHECK (((file_count > 0) AND (file_count <= 500))),
    CONSTRAINT skill_artifacts_sizes_check CHECK (((compressed_size_bytes > 0) AND (compressed_size_bytes <= 10485760) AND (unpacked_size_bytes > 0) AND (unpacked_size_bytes <= 52428800)))
);

CREATE TABLE tasklattice.skills (
    project_id text NOT NULL,
    id text NOT NULL,
    payload jsonb NOT NULL,
    sort_order integer DEFAULT 1000 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp(6) with time zone
);

CREATE TABLE tasklattice.user_notifications (
    id text NOT NULL,
    user_id text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    action_href text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_notifications_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'success'::text, 'warning'::text, 'error'::text])))
);

CREATE TABLE tasklattice.users (
    id text NOT NULL,
    username text,
    email text NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    theme text DEFAULT 'system'::text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    system_role tasklattice.system_role DEFAULT 'user'::tasklattice.system_role NOT NULL,
    status tasklattice.user_status DEFAULT 'active'::tasklattice.user_status NOT NULL,
    language text DEFAULT 'en-US'::text NOT NULL,
    external_platform_administrator boolean DEFAULT false NOT NULL
);

CREATE TABLE tasklattice.vector_document_revisions (
    project_id text NOT NULL,
    database_id text NOT NULL,
    document_id text NOT NULL,
    revision integer NOT NULL,
    content_hash text NOT NULL,
    source_bytes bytea,
    docling_document jsonb,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp(6) with time zone,
    CONSTRAINT vector_document_revisions_revision_check CHECK ((revision > 0))
);

CREATE TABLE tasklattice.vector_documents (
    project_id text NOT NULL,
    database_id text NOT NULL,
    id text NOT NULL,
    filename text NOT NULL,
    media_type text NOT NULL,
    byte_size integer NOT NULL,
    content_hash text NOT NULL,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    active_revision integer DEFAULT 1 NOT NULL,
    page_count integer DEFAULT 0 NOT NULL,
    chunk_count integer DEFAULT 0 NOT NULL,
    ocr_page_count integer DEFAULT 0 NOT NULL,
    parser text DEFAULT 'docling'::text NOT NULL,
    uploaded_by text,
    error text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    directory_path text DEFAULT '/'::text NOT NULL,
    folder_id uuid,
    custom_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT vector_documents_counts_check CHECK (((byte_size > 0) AND (active_revision > 0) AND (page_count >= 0) AND (chunk_count >= 0) AND (ocr_page_count >= 0))),
    CONSTRAINT vector_documents_custom_metadata_object_check CHECK ((jsonb_typeof(custom_metadata) = 'object'::text)),
    CONSTRAINT vector_documents_directory_path_check CHECK (((directory_path = '/'::text) OR ((directory_path ~~ '/%'::text) AND (directory_path !~~ '%//%'::text) AND (directory_path !~~ '%/'::text) AND (char_length(directory_path) <= 2000)))),
    CONSTRAINT vector_documents_parser_check CHECK ((parser = 'docling'::text)),
    CONSTRAINT vector_documents_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'PARSING'::text, 'EMBEDDING'::text, 'READY'::text, 'FAILED'::text])))
);

CREATE TABLE tasklattice.vector_folders (
    project_id text NOT NULL,
    database_id text NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT vector_folders_name_check CHECK (((name = btrim(name)) AND (name <> ''::text) AND (name <> ALL (ARRAY['.'::text, '..'::text])) AND (name !~~ '%/%'::text) AND (name !~~ '%\\%'::text) AND (char_length(name) <= 240)))
);

CREATE TABLE tasklattice.vector_ingestion_jobs (
    id uuid NOT NULL,
    project_id text NOT NULL,
    database_id text NOT NULL,
    document_id text NOT NULL,
    revision integer NOT NULL,
    queue_job_id uuid,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    phase text DEFAULT 'QUEUED'::text NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    error text,
    started_at timestamp(6) with time zone,
    completed_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT vector_ingestion_jobs_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT vector_ingestion_jobs_phase_check CHECK ((phase = ANY (ARRAY['QUEUED'::text, 'PARSING'::text, 'EMBEDDING'::text, 'FINALIZING'::text, 'COMPLETED'::text, 'FAILED'::text]))),
    CONSTRAINT vector_ingestion_jobs_progress_check CHECK (((progress >= 0) AND (progress <= 100))),
    CONSTRAINT vector_ingestion_jobs_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'COMPLETED'::text, 'FAILED'::text])))
);

ALTER TABLE ONLY tasklattice.model_usage_fact_observation ALTER COLUMN id SET DEFAULT nextval('tasklattice.model_usage_fact_observation_id_seq'::regclass);

INSERT INTO tasklattice.access_policies (project_id, id, payload, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', '00000000-0000-4000-8000-00000000da12', '{"id": "00000000-0000-4000-8000-00000000da12", "name": "Default", "status": "ACTIVE", "revision": 1, "createdAt": "2026-09-13T05:56:15.762578+00:00", "createdBy": "system:setup", "updatedAt": "2026-09-13T05:56:15.762578+00:00", "serverRules": []}', '2026-09-13 05:56:15.762578+00', '2026-09-13 05:56:15.762578+00', NULL);

INSERT INTO tasklattice.access_policy_versions (project_id, policy_id, revision, payload, created_at) VALUES ('tp-v3i65n4c7jslo', '00000000-0000-4000-8000-00000000da12', 1, '{"actor": "system:setup", "summary": "Default deny-all Access Policy created during Project setup.", "policyId": "00000000-0000-4000-8000-00000000da12", "revision": 1, "snapshot": {"id": "00000000-0000-4000-8000-00000000da12", "name": "Default", "status": "ACTIVE", "revision": 1, "createdAt": "2026-09-13T05:56:15.762578+00:00", "createdBy": "system:setup", "updatedAt": "2026-09-13T05:56:15.762578+00:00", "serverRules": []}, "createdAt": "2026-09-13T05:56:15.762578+00:00"}', '2026-09-13 05:56:15.762578+00');

INSERT INTO tasklattice.agent_specializations (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'general-purpose', '{"id": "general-purpose", "icon": "sparkles", "name": "General Purpose", "roleLabel": "General Assistant", "description": "A flexible Agent that starts without preselected capabilities.", "systemPrompt": "You are a focused internal assistant. Complete the user''s request inside the OpenShell sandbox and explain the evidence clearly.", "defaultSkillIds": [], "defaultMcpServerIds": [], "defaultKnowledgeSourceIds": []}', 0, '2026-09-13 05:56:14.1036+00', '2026-09-13 05:56:15.823976+00', NULL);
INSERT INTO tasklattice.agent_specializations (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'hr', '{"id": "hr", "icon": "users", "name": "HR", "roleLabel": "HR Specialist", "description": "Provides support for HR policies, employee onboarding, benefits, and internal HR processes.", "systemPrompt": "You are an HR support Agent. Answer employee questions using approved company policies and connected knowledge sources. Be clear about policy scope, protect confidential employee data, and escalate decisions that require a People Operations owner.", "defaultSkillIds": ["employee-policy-search", "document-summarization", "onboarding-guidance"], "defaultMcpServerIds": [], "defaultKnowledgeSourceIds": []}', 1, '2026-09-13 05:56:14.10565+00', '2026-09-13 05:56:15.823976+00', NULL);
INSERT INTO tasklattice.agent_specializations (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'research-analyst', '{"id": "research-analyst", "icon": "telescope", "name": "Research Analyst", "roleLabel": "Research Analyst", "description": "Collects evidence, compares sources, and produces citation-backed research.", "systemPrompt": "You are a research analyst. Investigate the request using approved sources, distinguish evidence from inference, cite material claims, surface uncertainty, and provide a concise decision-ready synthesis.", "defaultSkillIds": ["skill-web-research", "citation-builder", "document-summarization"], "defaultMcpServerIds": [], "defaultKnowledgeSourceIds": []}', 2, '2026-09-13 05:56:14.107293+00', '2026-09-13 05:56:15.823976+00', NULL);
INSERT INTO tasklattice.agent_specializations (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'devops-engineer', '{"id": "devops-engineer", "icon": "settings", "name": "DevOps Engineer", "roleLabel": "DevOps Engineer", "description": "Investigates operational issues and reviews infrastructure changes safely.", "systemPrompt": "You are a DevOps engineering Agent. Diagnose from observable evidence, preserve production safety, explain operational risk, and propose reversible changes with explicit verification and rollback steps.", "defaultSkillIds": ["incident-triage", "infrastructure-change-review", "helm-chart-developer", "kubernetes-expert", "ocp-expert"], "defaultMcpServerIds": [], "defaultKnowledgeSourceIds": []}', 3, '2026-09-13 05:56:14.109269+00', '2026-09-13 05:56:15.823976+00', NULL);
INSERT INTO tasklattice.agent_specializations (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'customer-support', '{"id": "customer-support", "icon": "headphones", "name": "Customer Support", "roleLabel": "Customer Support Specialist", "description": "Resolves product questions using approved support knowledge and escalation paths.", "systemPrompt": "You are a customer support Agent. Understand the customer''s goal, use approved support knowledge, give precise next actions, avoid unsupported claims, and escalate account or product issues that require a human owner.", "defaultSkillIds": ["customer-conversation-summary", "knowledge-answering"], "defaultMcpServerIds": [], "defaultKnowledgeSourceIds": []}', 4, '2026-09-13 05:56:14.111492+00', '2026-09-13 05:56:15.823976+00', NULL);
INSERT INTO tasklattice.agent_specializations (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'custom', '{"id": "custom", "icon": "briefcase", "name": "Custom", "roleLabel": "Custom Agent", "description": "Define custom instructions and assemble capabilities from the available catalog.", "systemPrompt": "", "defaultSkillIds": [], "defaultMcpServerIds": [], "defaultKnowledgeSourceIds": []}', 5, '2026-09-13 05:56:14.113828+00', '2026-09-13 05:56:15.823976+00', NULL);

INSERT INTO tasklattice.audit_logs (project_id, id, occurred_at, actor_type, actor_id, actor_name, actor_email, authorization_role, authorization_decision, action, verb, object_type, object_id, object_name, outcome, summary, request_id, http_method, route, ip_address, user_agent, parameters, request_body, metadata, trace_id, span_id, record_id, authorization_capability, authorization_reason) VALUES ('tp-v3i65n4c7jslo', 'audit-002', '2026-09-13 05:24:15.055721+00', 'user', 'maya-chen', 'Maya Chen', 'maya.chen@example.com', 'admin', 'allowed', 'access_policy.update', 'updated', 'Access Policy', 'production-guardrails', 'Production Guardrails', 'success', 'Updated Access Policy “Production Guardrails” from revision 6 to 7.', 'req_01JZ8F8P2BKRY8EFQCSJD18YDG', 'PUT', '/api/v1/projects/individual/access-policies/production-guardrails', '10.28.4.16', 'Chrome 138 · Windows', '{"policyId": "production-guardrails"}', '{"effect": "allow", "revision": 7, "conditions": {"environment": "production"}, "principals": ["virtual-employee:security-reviewer"]}', '{"changeTicket": "SEC-2841", "previousRevision": 6}', NULL, NULL, 'individual:audit-002', NULL, NULL);
INSERT INTO tasklattice.audit_logs (project_id, id, occurred_at, actor_type, actor_id, actor_name, actor_email, authorization_role, authorization_decision, action, verb, object_type, object_id, object_name, outcome, summary, request_id, http_method, route, ip_address, user_agent, parameters, request_body, metadata, trace_id, span_id, record_id, authorization_capability, authorization_reason) VALUES ('tp-v3i65n4c7jslo', 'audit-003', '2026-09-13 04:38:15.055721+00', 'user', 'local-admin', 'Local Administrator', 'admin@tasklattice.local', 'admin', 'allowed', 'project_member.invite', 'invited', 'Project Member', 'alex.kim@example.com', 'alex.kim@example.com', 'success', 'Invited alex.kim@example.com to this Project as a user.', 'req_01JZ8CQKMZE6R7NV8NGHZ0MGH4', 'POST', '/api/v1/projects/individual/members/invitations', '192.168.10.24', 'Chrome 138 · macOS', '{}', '{"role": "user", "email": "alex.kim@example.com"}', '{"notification": "queued"}', NULL, NULL, 'individual:audit-003', NULL, NULL);
INSERT INTO tasklattice.audit_logs (project_id, id, occurred_at, actor_type, actor_id, actor_name, actor_email, authorization_role, authorization_decision, action, verb, object_type, object_id, object_name, outcome, summary, request_id, http_method, route, ip_address, user_agent, parameters, request_body, metadata, trace_id, span_id, record_id, authorization_capability, authorization_reason) VALUES ('tp-v3i65n4c7jslo', 'audit-006', '2026-09-12 03:56:15.055721+00', 'user', 'local-admin', 'Local Administrator', 'admin@tasklattice.local', 'admin', 'allowed', 'project_quota.update', 'updated', 'Project Quota', 'individual', 'Project quota', 'success', 'Updated Project monthly budget and token limits.', 'req_01JZ5KQQYYM4PDS1QDTQG412HC', 'PUT', '/api/v1/projects/individual/quota', '192.168.10.24', 'Chrome 138 · macOS', '{}', '{"tpmLimit": 1200000, "hardBudgetUsd": 2500, "budgetDuration": "30d"}', '{"revision": 4, "previousHardBudgetUsd": 2000}', NULL, NULL, 'individual:audit-006', NULL, NULL);
INSERT INTO tasklattice.audit_logs (project_id, id, occurred_at, actor_type, actor_id, actor_name, actor_email, authorization_role, authorization_decision, action, verb, object_type, object_id, object_name, outcome, summary, request_id, http_method, route, ip_address, user_agent, parameters, request_body, metadata, trace_id, span_id, record_id, authorization_capability, authorization_reason) VALUES ('tp-v3i65n4c7jslo', 'audit-007', '2026-09-11 01:56:15.055721+00', 'system', 'policy-reconciler', 'Policy Reconciler', NULL, 'system', 'allowed', 'access_policy.reconcile', 'reconciled', 'Access Policy', 'production-guardrails', 'Production Guardrails', 'success', 'Reconciled Access Policy “Production Guardrails” with the enforcement gateway.', 'req_01JZ33CF90S0KVKRDHKQBWQ3V7', 'POST', '/internal/reconciliation/access-policies/production-guardrails', '10.42.1.8', 'TaskLattice Policy Reconciler/0.2', '{"revision": 6}', NULL, '{"gateway": "managed", "durationMs": 418}', NULL, NULL, 'individual:audit-007', NULL, NULL);
INSERT INTO tasklattice.audit_logs (project_id, id, occurred_at, actor_type, actor_id, actor_name, actor_email, authorization_role, authorization_decision, action, verb, object_type, object_id, object_name, outcome, summary, request_id, http_method, route, ip_address, user_agent, parameters, request_body, metadata, trace_id, span_id, record_id, authorization_capability, authorization_reason) VALUES ('tp-v3i65n4c7jslo', 'audit-008', '2026-09-07 02:56:15.055721+00', 'user', 'alex-kim', 'Alex Kim', 'alex.kim@example.com', 'user', 'allowed', 'knowledge_source.read', 'viewed', 'Knowledge Source', 'security-runbooks', 'Security Runbooks', 'success', 'Viewed Knowledge Source “Security Runbooks”.', 'req_01JYN10K26PGDVSK7SDS1CV9T0', 'GET', '/api/v1/projects/individual/catalog', '172.16.8.44', 'Safari 18 · macOS', '{"id": "security-runbooks", "kind": "knowledge-source"}', NULL, '{"responseStatus": 200}', NULL, NULL, 'individual:audit-008', NULL, NULL);
INSERT INTO tasklattice.audit_logs (project_id, id, occurred_at, actor_type, actor_id, actor_name, actor_email, authorization_role, authorization_decision, action, verb, object_type, object_id, object_name, outcome, summary, request_id, http_method, route, ip_address, user_agent, parameters, request_body, metadata, trace_id, span_id, record_id, authorization_capability, authorization_reason) VALUES ('tp-v3i65n4c7jslo', 'audit-001', '2026-09-13 05:52:15.055721+00', 'user', 'local-admin', 'Local Administrator', 'admin@tasklattice.local', 'admin', 'allowed', 'instance.create', 'created', 'Instance', 'research-assistant', 'Research Assistant', 'success', 'Created Instance “Research Assistant” with the OpenClaw runtime.', 'req_01JZ8GFA1W8Q6BRF5TF5V6M5TQ', 'POST', '/api/v1/projects/individual/instances', '192.168.10.24', 'Chrome 138 · macOS', '{"source": "console"}', '{"name": "Research Assistant", "runtime": "openclaw", "instructions": "[REDACTED]", "modelProfileId": "balanced-global"}', '{"region": "cn-shanghai", "schemaVersion": 1}', '6e7f1c9a4c824b1aa7a5e68a0b134101', '8a6cb93f82c6461a', 'individual:audit-001', NULL, NULL);
INSERT INTO tasklattice.audit_logs (project_id, id, occurred_at, actor_type, actor_id, actor_name, actor_email, authorization_role, authorization_decision, action, verb, object_type, object_id, object_name, outcome, summary, request_id, http_method, route, ip_address, user_agent, parameters, request_body, metadata, trace_id, span_id, record_id, authorization_capability, authorization_reason) VALUES ('tp-v3i65n4c7jslo', 'audit-004', '2026-09-13 02:50:15.055721+00', 'service_account', 'deployment-bot', 'Deployment Bot', NULL, 'automation', 'allowed', 'runtime_policy.update', 'updated', 'Runtime Policy', 'restricted-egress', 'Restricted Egress', 'failed', 'Runtime Policy update failed validation because two network rules overlapped.', 'req_01JZ86X0EZ0X7BQ42RYCGQY79C', 'PUT', '/api/v1/projects/individual/runtime-policies/restricted-egress', '10.42.0.17', 'TaskLattice Deploy Bot/1.8', '{"dryRun": false}', '{"networkRules": [{"host": "*.internal.example", "port": 443}, {"host": "api.internal.example", "port": 443}]}', '{"pipeline": "policy-sync", "validationCode": "OVERLAPPING_NETWORK_RULES"}', '903fca7d2c204964bd1af2107062fdb4', 'e35b0b754d4f1f7c', 'individual:audit-004', NULL, NULL);
INSERT INTO tasklattice.audit_logs (project_id, id, occurred_at, actor_type, actor_id, actor_name, actor_email, authorization_role, authorization_decision, action, verb, object_type, object_id, object_name, outcome, summary, request_id, http_method, route, ip_address, user_agent, parameters, request_body, metadata, trace_id, span_id, record_id, authorization_capability, authorization_reason) VALUES ('tp-v3i65n4c7jslo', 'audit-005', '2026-09-13 00:14:15.055721+00', 'user', 'maya-chen', 'Maya Chen', 'maya.chen@example.com', 'admin', 'denied', 'mcp_server.delete', 'deleted', 'MCP Server', 'production-github', 'Production GitHub', 'denied', 'Deletion of MCP Server “Production GitHub” was denied by a retention policy.', 'req_01JZ7Y7W7BF3CJJK43F6Q4CEEW', 'DELETE', '/api/v1/projects/individual/catalog/mcp-servers/production-github', '10.28.4.16', 'Chrome 138 · Windows', '{"force": false}', NULL, '{"policy": "retain-active-integrations", "activeBindings": 3}', 'b2884545403a40b3a9c5d6be1c68068f', '9ab3cb2a72c7a1fd', 'individual:audit-005', NULL, NULL);

INSERT INTO tasklattice.department_members (department_id, user_id, status, joined_at, role, manual_access, external_access_active) VALUES ('dep1', 'local-admin', 'active', '2026-09-13 05:56:16.771699+00', 'administrator', true, false);

INSERT INTO tasklattice.departments (id, name, description, hard_budget_usd, status, created_by, created_at, updated_at, default_chat_model, default_embedding_model, default_routing_mode, default_fallback_model, soft_budget_usd, soft_max_instances, hard_max_instances, soft_max_mcp_integrations, hard_max_mcp_integrations, soft_max_knowledge_base_integrations, hard_max_knowledge_base_integrations, default_project_hard_budget_usd, default_project_budget_duration, default_project_tpm_limit, default_project_max_instances, default_project_max_mcp_integrations, default_project_max_knowledge_base_integrations, settings_revision) VALUES ('dep1', 'dep1', 'Default local Department for Project organization and budget governance.', NULL, 'active', 'local-admin', '2026-09-13 05:56:16.769617+00', '2026-09-13 05:56:16.769617+00', NULL, NULL, 'PROJECT_MANAGED', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1);

INSERT INTO tasklattice.project_member_role_assignments (project_id, user_id, role, assigned_at, manual_assignment, external_assignment_active) VALUES ('tp-v3i65n4c7jslo', 'local-admin', 'admin', '2026-09-13 05:56:16.500858+00', true, false);
INSERT INTO tasklattice.project_member_role_assignments (project_id, user_id, role, assigned_at, manual_assignment, external_assignment_active) VALUES ('tp-v3i65n4c7jslo', 'local-admin', 'developer', '2026-09-13 05:56:16.562189+00', true, false);

INSERT INTO tasklattice.project_members (project_id, user_id, role, joined_at, manual_access, external_access_active) VALUES ('tp-v3i65n4c7jslo', 'local-admin', 'admin', '2026-09-13 05:56:14.038179+00', true, false);

INSERT INTO tasklattice.project_quotas (project_id, hard_budget_usd, budget_duration, tpm_limit, max_instances, max_mcp_integrations, max_knowledge_base_integrations, litellm_team_id, sync_status, last_synced_at, last_sync_error, updated_by, revision, created_at, updated_at, budget_period_started_at, budget_resets_at) VALUES ('tp-v3i65n4c7jslo', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'pending', NULL, NULL, NULL, 1, '2026-09-13 05:56:14.347962+00', '2026-09-13 05:56:14.347962+00', NULL, NULL);

INSERT INTO tasklattice.projects (id, name, avatar, created_by, created_at, updated_at, deleted_at, deleted_by, department_id, inherited_department_defaults, inherited_department_settings_revision) VALUES ('tp-v3i65n4c7jslo', 'proj1', NULL, 'local-admin', '2026-09-13 05:56:14.034551+00', '2026-09-13 05:56:14.034551+00', NULL, NULL, 'dep1', NULL, NULL);

INSERT INTO tasklattice.sandbox_policies (project_id, id, payload, created_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'github-readonly', '{"id": "github-readonly", "name": "GitHub Read-only", "source": "BUILT_IN", "immutable": true, "policyYaml": "version: 1\nfilesystem_policy:\n  include_workdir: true\n  read_only:\n    - /usr\n    - /opt\n    - /lib\n    - /proc\n    - /dev/urandom\n    - /etc\n    - /var/log\n  read_write:\n    - /sandbox\n    - /tmp\n    - /dev/null\nlandlock:\n  compatibility: best_effort\nprocess:\n  run_as_user: sandbox\n  run_as_group: sandbox\nnetwork_policies:\n  github_api:\n    name: github-api\n    endpoints:\n      - host: api.github.com\n        port: 443\n        protocol: rest\n        enforcement: enforce\n        access: read-only\n    binaries:\n      - path: /usr/bin/gh\n      - path: /usr/bin/curl\n", "description": "Allows gh and curl to read the GitHub API while write methods remain denied.", "enforcement": "ENFORCE", "networkAccess": "api.github.com · GET, HEAD, OPTIONS"}', '1970-01-01 00:00:00+00', NULL);
INSERT INTO tasklattice.sandbox_policies (project_id, id, payload, created_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'github-full-access', '{"id": "github-full-access", "name": "GitHub Full Access", "source": "BUILT_IN", "immutable": true, "policyYaml": "version: 1\nfilesystem_policy:\n  include_workdir: true\n  read_only:\n    - /usr\n    - /opt\n    - /lib\n    - /proc\n    - /dev/urandom\n    - /etc\n    - /var/log\n  read_write:\n    - /sandbox\n    - /tmp\n    - /dev/null\nlandlock:\n  compatibility: best_effort\nprocess:\n  run_as_user: sandbox\n  run_as_group: sandbox\nnetwork_policies:\n  github_api_full_access:\n    name: github-api-full-access\n    endpoints:\n      - host: api.github.com\n        port: 443\n        protocol: rest\n        enforcement: enforce\n        access: full\n    binaries:\n      - path: /usr/bin/gh\n      - path: /usr/bin/curl\n", "description": "Allows every HTTP method and path on the declared GitHub API endpoint.", "enforcement": "ENFORCE", "networkAccess": "api.github.com · all methods and paths"}', '1970-01-01 00:00:00+00', NULL);
INSERT INTO tasklattice.sandbox_policies (project_id, id, payload, created_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'unrestricted', '{"id": "unrestricted", "name": "Unrestricted", "source": "BUILT_IN", "immutable": true, "policyYaml": "version: 1\nfilesystem_policy:\n  include_workdir: true\n  read_only:\n    - /usr\n    - /opt\n    - /lib\n    - /proc\n    - /dev/urandom\n    - /etc\n    - /var/log\n  read_write:\n    - /sandbox\n    - /tmp\n    - /dev/null\nlandlock:\n  compatibility: best_effort\nprocess:\n  run_as_user: sandbox\n  run_as_group: sandbox\nnetwork_policies: {}\n", "description": "Allows arbitrary shell, file creation, modification, and execution inside sandbox-owned writable paths.", "enforcement": "ENFORCE", "networkAccess": "Managed inference · operator-approved outbound destinations"}', '1970-01-01 00:00:00+00', '2026-09-13 05:56:18.763737+00');
INSERT INTO tasklattice.sandbox_policies (project_id, id, payload, created_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'restricted', '{"id": "restricted", "name": "Restricted", "source": "BUILT_IN", "immutable": true, "policyYaml": "version: 1\nfilesystem_policy:\n  include_workdir: true\n  read_only:\n    - /usr\n    - /opt\n    - /lib\n    - /proc\n    - /dev/urandom\n    - /etc\n    - /var/log\n  read_write:\n    - /sandbox\n    - /tmp\n    - /dev/null\nlandlock:\n  compatibility: best_effort\nprocess:\n  run_as_user: sandbox\n  run_as_group: sandbox\nnetwork_policies: {}\n", "description": "Uses the writable runtime baseline while denying additional outbound destinations by default.", "enforcement": "ENFORCE", "networkAccess": "Managed inference only"}', '1970-01-01 00:00:00+00', '2026-09-13 05:56:18.763737+00');
INSERT INTO tasklattice.sandbox_policies (project_id, id, payload, created_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'package-install', '{"id": "package-install", "name": "Package Install", "source": "BUILT_IN", "immutable": true, "policyYaml": "version: 1\nfilesystem_policy:\n  include_workdir: true\n  read_only:\n    - /usr\n    - /opt\n    - /lib\n    - /proc\n    - /dev/urandom\n    - /etc\n    - /var/log\n  read_write:\n    - /sandbox\n    - /tmp\n    - /dev/null\nlandlock:\n  compatibility: best_effort\nprocess:\n  run_as_user: sandbox\n  run_as_group: sandbox\nnetwork_policies:\n  package_registries:\n    name: package-registries\n    endpoints:\n      - host: registry.npmjs.org\n        port: 443\n      - host: pypi.org\n        port: 443\n      - host: files.pythonhosted.org\n        port: 443\n    binaries:\n      - path: /usr/bin/npm\n      - path: /usr/bin/pip\n      - path: /usr/local/bin/pip\n      - path: /usr/local/bin/uv\n", "description": "Allows package managers to reach the npm and Python package registries.", "enforcement": "ENFORCE", "networkAccess": "npmjs.org · pypi.org · pythonhosted.org"}', '1970-01-01 00:00:00+00', NULL);
INSERT INTO tasklattice.sandbox_policies (project_id, id, payload, created_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'managed-runtime', '{"id": "managed-runtime", "name": "Managed Runtime", "source": "BUILT_IN", "immutable": true, "policyYaml": "version: 1\nfilesystem_policy:\n  include_workdir: true\n  read_only:\n    - /usr\n    - /opt\n    - /lib\n    - /proc\n    - /dev/urandom\n    - /etc\n    - /var/log\n  read_write:\n    - /sandbox\n    - /tmp\n    - /dev/null\nlandlock:\n  compatibility: best_effort\nprocess:\n  run_as_user: sandbox\n  run_as_group: sandbox\nnetwork_policies: {}\n", "description": "Provides the writable Agent runtime baseline while denying undeclared outbound destinations.", "enforcement": "ENFORCE", "networkAccess": "Managed Providers only · Toolbox grants are composed explicitly"}', '1970-01-01 00:00:00+00', NULL);

INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'employee-policy-search', '{"id": "employee-policy-search", "name": "Employee Policy Search", "owner": "People Operations", "author": "People Operations", "digest": "sha256:1d83…8d12", "status": "PUBLISHED", "version": "1.2.0", "category": "HR", "endpoint": "https://skills.internal.example/employee-policy-search.tar.zst", "useCases": ["Answer leave, benefits, and workplace policy questions", "Locate the approved policy behind an HR answer"], "updatedAt": "2026-09-13T05:56:14.040Z", "trustLevel": "TRUSTED_SOURCE", "usageGuide": "Connect an approved HR knowledge source, then ask a specific policy question. The Skill returns an answer with the relevant policy context for review.", "description": "Find and answer questions about company HR policies.", "permissions": 1, "compatibleAgents": ["hermes", "openai"], "problemStatement": "Employees lose time searching across policy documents and may act on outdated or incomplete guidance."}', 0, '2026-09-13 05:56:14.040272+00', '2026-09-13 05:56:14.040272+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'document-summarization', '{"id": "document-summarization", "name": "Document Summarization", "owner": "Knowledge Team", "author": "TaskLattice Knowledge", "digest": "sha256:b92f…3b06", "status": "PUBLISHED", "version": "2.0.1", "category": "Knowledge", "endpoint": "https://skills.internal.example/document-summarization.tar.zst", "useCases": ["Create an executive summary of an internal document", "Extract decisions, risks, and follow-up actions from a report"], "updatedAt": "2026-09-13T05:56:14.043Z", "trustLevel": "BUILT_IN", "usageGuide": "Provide one or more approved documents and specify the audience and desired level of detail. Review cited source sections before sharing the summary.", "description": "Summarize HR documents and reports.", "permissions": 1, "compatibleAgents": ["hermes", "openai"], "problemStatement": "Long internal documents are difficult to review quickly and important decisions can be hidden in supporting detail."}', 1, '2026-09-13 05:56:14.043415+00', '2026-09-13 05:56:14.043415+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'onboarding-guidance', '{"id": "onboarding-guidance", "name": "Onboarding Guidance", "owner": "People Operations", "author": "People Operations", "digest": "sha256:8aa7…011c", "status": "PUBLISHED", "version": "1.1.0", "category": "HR", "endpoint": "https://skills.internal.example/onboarding-guidance.tar.zst", "useCases": ["Guide a new hire through their first-week checklist", "Answer role-specific onboarding questions"], "updatedAt": "2026-09-13T05:56:14.046Z", "trustLevel": "TRUSTED_SOURCE", "usageGuide": "Provide the employee role, location, and start date. Connect the approved onboarding knowledge source before requesting a personalized checklist.", "description": "Guide new hires through onboarding steps and resources.", "permissions": 2, "compatibleAgents": ["hermes", "openclaw"], "problemStatement": "New hires receive fragmented onboarding instructions and managers repeat the same coordination work."}', 2, '2026-09-13 05:56:14.04628+00', '2026-09-13 05:56:14.04628+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'data-extraction', '{"id": "data-extraction", "name": "Data Extraction", "owner": "Data Platform", "author": "TaskLattice Data", "digest": "sha256:f6f1…1c0d", "status": "PUBLISHED", "version": "1.3.0", "category": "Data", "endpoint": "https://skills.internal.example/data-extraction.tar.zst", "useCases": ["Extract invoice or form fields into JSON", "Normalize repeated document fields for a workflow"], "updatedAt": "2026-09-13T05:56:14.049Z", "trustLevel": "BUILT_IN", "usageGuide": "Provide the source document and the expected field schema. Validate required fields and confidence-sensitive values before sending the result downstream.", "description": "Extract structured data from documents and forms.", "permissions": 2, "compatibleAgents": ["hermes", "openclaw", "openai"], "problemStatement": "Operational data arrives in inconsistent documents and forms that cannot be processed reliably by downstream systems."}', 3, '2026-09-13 05:56:14.049386+00', '2026-09-13 05:56:14.049386+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'citation-builder', '{"id": "citation-builder", "name": "Citation Builder", "owner": "Knowledge Team", "author": "Knowledge Team", "digest": "sha256:2c81…77f2", "status": "PUBLISHED", "version": "1.5.0", "category": "Research", "endpoint": "https://skills.internal.example/citation-builder.tar.zst", "useCases": ["Add traceable evidence to a research brief", "Normalize source references collected by multiple Agents"], "updatedAt": "2026-09-13T05:56:14.052Z", "trustLevel": "TRUSTED_SOURCE", "usageGuide": "Pass the research findings together with their source URLs or documents. The Skill produces normalized citations and flags claims without supporting evidence.", "description": "Create traceable citations for research findings.", "permissions": 1, "compatibleAgents": ["openai", "claude-code"], "problemStatement": "Research claims are difficult to audit when evidence links and source context are assembled manually."}', 4, '2026-09-13 05:56:14.052531+00', '2026-09-13 05:56:14.052531+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'incident-triage', '{"id": "incident-triage", "name": "Incident Triage", "owner": "Platform Operations", "author": "TaskLattice Operations", "digest": "sha256:8a20…5f02", "status": "PUBLISHED", "version": "2.2.0", "category": "Operations", "endpoint": "https://skills.internal.example/incident-triage.tar.zst", "useCases": ["Prepare the first incident briefing", "Correlate alerts with recent infrastructure changes"], "updatedAt": "2026-09-13T05:56:14.055Z", "trustLevel": "BUILT_IN", "usageGuide": "Connect read-only observability sources and provide the alert context. Use the generated summary as evidence for a responder, not as authorization to execute changes.", "description": "Triage service alerts and assemble an evidence-backed incident summary.", "permissions": 3, "compatibleAgents": ["hermes", "openclaw", "claude-code"], "problemStatement": "Responders spend critical time correlating alerts, logs, and recent changes before they can choose the next action."}', 5, '2026-09-13 05:56:14.055376+00', '2026-09-13 05:56:14.055376+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'infrastructure-change-review', '{"id": "infrastructure-change-review", "name": "Infrastructure Change Review", "owner": "Platform Operations", "author": "Platform Operations", "digest": "sha256:22d4…10ac", "status": "PUBLISHED", "version": "1.8.0", "category": "Operations", "endpoint": "https://skills.internal.example/infrastructure-change-review.tar.zst", "useCases": ["Review a pull request containing infrastructure changes", "Check a deployment plan against platform safeguards"], "updatedAt": "2026-09-13T05:56:14.057Z", "trustLevel": "TRUSTED_SOURCE", "usageGuide": "Provide the proposed diff and target environment. Connect the relevant policy source, then review every warning before approving the change.", "description": "Review infrastructure changes against operational safeguards.", "permissions": 4, "compatibleAgents": ["openclaw", "claude-code", "openai"], "problemStatement": "Infrastructure changes can bypass operational conventions or introduce risks that are difficult to spot during manual review."}', 6, '2026-09-13 05:56:14.057571+00', '2026-09-13 05:56:14.057571+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'customer-conversation-summary', '{"id": "customer-conversation-summary", "name": "Customer Conversation Summary", "owner": "Customer Experience", "author": "TaskLattice Customer Experience", "digest": "sha256:51b9…70ee", "status": "PUBLISHED", "version": "1.4.0", "category": "Customer Support", "endpoint": "https://skills.internal.example/customer-conversation-summary.tar.zst", "useCases": ["Create a handoff summary for another support owner", "Extract the customer''s goal, blockers, and promised actions"], "updatedAt": "2026-09-13T05:56:14.060Z", "trustLevel": "BUILT_IN", "usageGuide": "Provide the conversation transcript and optional account context. Confirm sensitive details are appropriate for the destination before sharing the summary.", "description": "Summarize customer conversations and identify the requested outcome.", "permissions": 2, "compatibleAgents": ["hermes", "openai"], "problemStatement": "Support teams lose context when long conversations are handed between people or Agents."}', 7, '2026-09-13 05:56:14.060628+00', '2026-09-13 05:56:14.060628+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'knowledge-answering', '{"id": "knowledge-answering", "name": "Knowledge Answering", "owner": "Customer Experience", "author": "Customer Experience", "digest": "sha256:64cc…c501", "status": "PUBLISHED", "version": "2.3.0", "category": "Customer Support", "endpoint": "https://skills.internal.example/knowledge-answering.tar.zst", "useCases": ["Answer a product usage question", "Explain an approved troubleshooting procedure"], "updatedAt": "2026-09-13T05:56:14.063Z", "trustLevel": "TRUSTED_SOURCE", "usageGuide": "Attach an approved product knowledge source and ask a focused question. The Skill should be configured to cite the material used for the answer.", "description": "Answer product questions using approved support knowledge.", "permissions": 1, "compatibleAgents": ["hermes", "openclaw", "openai"], "problemStatement": "Support answers become inconsistent when Agents rely on memory instead of the current approved knowledge base."}', 8, '2026-09-13 05:56:14.063507+00', '2026-09-13 05:56:14.063507+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'skill-sql-query', '{"id": "skill-sql-query", "name": "SQL Query", "owner": "Data Platform", "author": "TaskLattice Data", "digest": "sha256:9a76…12f4", "status": "PUBLISHED", "version": "1.4.2", "category": "Data", "endpoint": "https://skills.internal.example/sql-query.tar.zst", "useCases": ["Answer a reporting question from an approved database", "Retrieve read-only records for another workflow step"], "updatedAt": "2026-09-13T05:56:14.066Z", "trustLevel": "BUILT_IN", "usageGuide": "Connect a read-only database identity, describe the required result, and review the generated query and row limits before execution.", "description": "Run governed read-only queries and return structured results.", "permissions": 2, "compatibleAgents": ["claude-code", "openai"], "problemStatement": "Agents need structured business data but unrestricted SQL access creates correctness and security risks."}', 9, '2026-09-13 05:56:14.066169+00', '2026-09-13 05:56:14.066169+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'skill-code-generation', '{"id": "skill-code-generation", "name": "Code Generation", "owner": "Developer Experience", "author": "Developer Experience", "digest": "Pending source check", "status": "DRAFT", "version": "0.9.0", "category": "Developer Tools", "endpoint": "https://skills.internal.example/code-generation.tar.zst", "useCases": ["Draft a scoped implementation from an issue", "Refactor code and produce a reviewable patch"], "updatedAt": "2026-09-13T05:56:14.069Z", "trustLevel": "UNSAFE", "usageGuide": "Attach the Skill only to an isolated development Agent. Provide repository scope, acceptance criteria, and allowed commands; review the patch and tests before merging.", "description": "Generate and revise code inside an approved project boundary.", "permissions": 4, "compatibleAgents": ["openclaw", "claude-code", "openai"], "problemStatement": "Engineering tasks require repetitive code changes, but generated patches need explicit repository and execution boundaries."}', 10, '2026-09-13 05:56:14.06912+00', '2026-09-13 05:56:14.06912+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'skill-web-research', '{"id": "skill-web-research", "name": "Web Research", "owner": "Knowledge Team", "author": "Knowledge Team", "digest": "sha256:4bd3…88a1", "status": "PUBLISHED", "version": "2.1.0", "category": "Research", "endpoint": "https://skills.internal.example/web-research.tar.zst", "useCases": ["Investigate a current technical topic", "Collect sources for a market or product comparison"], "updatedAt": "2026-09-13T05:56:14.071Z", "trustLevel": "TRUSTED_SOURCE", "usageGuide": "State the research question, date sensitivity, and source constraints. Review source quality and publication dates before accepting the synthesized findings.", "description": "Collect public sources and produce citation-backed research notes.", "permissions": 3, "compatibleAgents": ["hermes", "openclaw", "openai"], "problemStatement": "Open-web research is slow to reproduce and conclusions are easy to separate from their original sources."}', 11, '2026-09-13 05:56:14.071512+00', '2026-09-13 05:56:14.071512+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'helm-chart-developer', '{"id": "helm-chart-developer", "name": "Helm Chart Developer", "owner": "Platform Engineering", "author": "Platform Engineering", "digest": "sha256:development-seed-helm", "status": "PUBLISHED", "version": "1.0.0", "category": "Developer Tools", "endpoint": "https://skills.internal.example/helm-chart-developer.tar.zst", "useCases": ["Create or update a Helm chart", "Diagnose rendering and values override problems"], "updatedAt": "2026-09-13T05:56:14.073Z", "trustLevel": "TRUSTED_SOURCE", "usageGuide": "Provide the chart, target Kubernetes versions, and environment values. Render and lint the result before allowing any cluster deployment.", "description": "Design, review, and troubleshoot Helm charts, templates, values, and release packaging.", "permissions": 3, "compatibleAgents": ["openclaw", "claude-code"], "problemStatement": "Helm changes are difficult to validate across environments and template mistakes often appear only during deployment."}', 12, '2026-09-13 05:56:14.073416+00', '2026-09-13 05:56:14.073416+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'kubernetes-expert', '{"id": "kubernetes-expert", "name": "Kubernetes Expert", "owner": "Platform Engineering", "author": "Platform Engineering", "digest": "sha256:development-seed-kubernetes", "status": "PUBLISHED", "version": "1.0.0", "category": "Developer Tools", "endpoint": "https://skills.internal.example/kubernetes-expert.tar.zst", "useCases": ["Diagnose a failing workload", "Draft a safe Kubernetes manifest or operational change"], "updatedAt": "2026-09-13T05:56:14.075Z", "trustLevel": "TRUSTED_SOURCE", "usageGuide": "Start with read-only cluster context and the affected manifests. Require operator approval before applying generated changes to a cluster.", "description": "Diagnose Kubernetes workloads and author safe manifests, controllers, and operational changes.", "permissions": 4, "compatibleAgents": ["openclaw", "claude-code", "openai"], "problemStatement": "Kubernetes failures require correlating manifests, runtime state, and platform constraints without granting unnecessary write access."}', 13, '2026-09-13 05:56:14.075263+00', '2026-09-13 05:56:14.075263+00', NULL);
INSERT INTO tasklattice.skills (project_id, id, payload, sort_order, created_at, updated_at, deleted_at) VALUES ('tp-v3i65n4c7jslo', 'ocp-expert', '{"id": "ocp-expert", "name": "OCP Expert", "owner": "Platform Engineering", "author": "Platform Engineering", "digest": "sha256:development-seed-ocp", "status": "PUBLISHED", "version": "1.0.0", "category": "Operations", "endpoint": "https://skills.internal.example/ocp-expert.tar.zst", "useCases": ["Troubleshoot Routes, Operators, or SCC behavior", "Review an OpenShift-specific deployment plan"], "updatedAt": "2026-09-13T05:56:14.077Z", "trustLevel": "TRUSTED_SOURCE", "usageGuide": "Provide the cluster version, namespace, relevant resources, and read-only diagnostics. Escalate SCC or cluster-wide changes for explicit approval.", "description": "Operate OpenShift clusters with expertise in Routes, Operators, SCCs, and platform-specific workflows.", "permissions": 4, "compatibleAgents": ["hermes", "openclaw", "claude-code"], "problemStatement": "OpenShift adds platform-specific security and lifecycle behavior that generic Kubernetes guidance can miss."}', 14, '2026-09-13 05:56:14.077599+00', '2026-09-13 05:56:14.077599+00', NULL);

INSERT INTO tasklattice.users (id, username, email, display_name, created_at, updated_at, timezone, theme, email_verified, image, system_role, status, language, external_platform_administrator) VALUES ('local-admin', 'admin', 'admin@tasklattice.local', 'Local Administrator', '2026-09-13 05:56:14.030584+00', '2026-09-13 05:56:14.030584+00', 'UTC', 'system', false, NULL, 'platform_administrator', 'active', 'en-US', false);

SELECT pg_catalog.setval('tasklattice.model_usage_fact_observation_id_seq', 1, false);

ALTER TABLE ONLY tasklattice.access_context_sessions
    ADD CONSTRAINT access_context_sessions_pkey PRIMARY KEY (session_id);

ALTER TABLE ONLY tasklattice.access_policies
    ADD CONSTRAINT access_policies_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.access_policy_versions
    ADD CONSTRAINT access_policy_versions_pkey PRIMARY KEY (project_id, policy_id, revision);

ALTER TABLE ONLY tasklattice.agent_catalog
    ADD CONSTRAINT agent_catalog_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.agent_instance_access_policy_bindings
    ADD CONSTRAINT agent_instance_access_policy_bindings_pkey PRIMARY KEY (project_id, instance_id, access_policy_id);

ALTER TABLE ONLY tasklattice.agent_specializations
    ADD CONSTRAINT agent_specializations_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (record_id);

ALTER TABLE ONLY tasklattice.audit_logs
    ADD CONSTRAINT audit_logs_project_id_id_key UNIQUE (project_id, id);

ALTER TABLE ONLY tasklattice.auth_accounts
    ADD CONSTRAINT auth_accounts_issuer_account_id_key UNIQUE (issuer, account_id);

ALTER TABLE ONLY tasklattice.auth_accounts
    ADD CONSTRAINT auth_accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.auth_sessions
    ADD CONSTRAINT auth_sessions_token_key UNIQUE (token);

ALTER TABLE ONLY tasklattice.auth_verifications
    ADD CONSTRAINT auth_verifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.capability_definitions
    ADD CONSTRAINT capability_definitions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.cost_attribution_mapping
    ADD CONSTRAINT cost_attribution_mapping_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.cost_sync_checkpoint
    ADD CONSTRAINT cost_sync_checkpoint_pkey PRIMARY KEY (project_id, source);

ALTER TABLE ONLY tasklattice.department_inference_resources
    ADD CONSTRAINT department_inference_resources_pkey PRIMARY KEY (department_id, id);

ALTER TABLE ONLY tasklattice.department_members
    ADD CONSTRAINT department_members_pkey PRIMARY KEY (department_id, user_id);

ALTER TABLE ONLY tasklattice.department_model_routing_audit
    ADD CONSTRAINT department_model_routing_audit_pkey PRIMARY KEY (department_id, event_id);

ALTER TABLE ONLY tasklattice.departments
    ADD CONSTRAINT departments_name_key UNIQUE (name);

ALTER TABLE ONLY tasklattice.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.expert_agent_members
    ADD CONSTRAINT expert_agent_members_pkey PRIMARY KEY (project_id, agent_id, user_id);

ALTER TABLE ONLY tasklattice.expert_agent_test_runs
    ADD CONSTRAINT expert_agent_test_runs_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.expert_agent_version_artifacts
    ADD CONSTRAINT expert_agent_version_artifacts_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.expert_agent_versions
    ADD CONSTRAINT expert_agent_versions_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.expert_agents
    ADD CONSTRAINT expert_agents_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.external_role_bindings
    ADD CONSTRAINT external_role_bindings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.external_role_grants
    ADD CONSTRAINT external_role_grants_pkey PRIMARY KEY (binding_id, user_id);

ALTER TABLE ONLY tasklattice.inference_gateways
    ADD CONSTRAINT inference_gateways_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.instance_lifecycle_events
    ADD CONSTRAINT instance_lifecycle_events_pkey PRIMARY KEY (project_id, operation_id, sequence);

ALTER TABLE ONLY tasklattice.instance_lifecycle_operations
    ADD CONSTRAINT instance_lifecycle_operations_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.knowledge_sources
    ADD CONSTRAINT knowledge_sources_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.knowledge_vector_chunks
    ADD CONSTRAINT knowledge_vector_chunks_pkey PRIMARY KEY (project_id, database_id, id);

ALTER TABLE ONLY tasklattice.knowledge_vector_databases
    ADD CONSTRAINT knowledge_vector_databases_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.mcp_servers
    ADD CONSTRAINT mcp_servers_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.mcp_tools
    ADD CONSTRAINT mcp_tools_pkey PRIMARY KEY (project_id, mcp_server_id, name);

ALTER TABLE ONLY tasklattice.memories
    ADD CONSTRAINT memories_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.memory_bindings
    ADD CONSTRAINT memory_bindings_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.memory_curation_events
    ADD CONSTRAINT memory_curation_events_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.memory_experience_projections
    ADD CONSTRAINT memory_experience_projections_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.memory_outbox
    ADD CONSTRAINT memory_outbox_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.model_deployments
    ADD CONSTRAINT model_deployments_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.model_endpoint_mapping
    ADD CONSTRAINT model_endpoint_mapping_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.model_routing_audit
    ADD CONSTRAINT model_profile_audit_pkey PRIMARY KEY (project_id, event_id);

ALTER TABLE ONLY tasklattice.model_routing_bindings
    ADD CONSTRAINT model_profile_bindings_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.model_routings
    ADD CONSTRAINT model_profiles_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.model_usage_daily
    ADD CONSTRAINT model_usage_daily_pkey PRIMARY KEY (project_id, usage_date, timezone, group_type, group_id);

ALTER TABLE ONLY tasklattice.model_usage_fact_observation
    ADD CONSTRAINT model_usage_fact_observation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.model_usage_fact_observation
    ADD CONSTRAINT model_usage_fact_observation_project_id_event_id_key UNIQUE (project_id, event_id);

ALTER TABLE ONLY tasklattice.model_usage_fact
    ADD CONSTRAINT model_usage_fact_pkey PRIMARY KEY (project_id, event_id);

ALTER TABLE ONLY tasklattice.model_usage_fact
    ADD CONSTRAINT model_usage_fact_project_id_request_id_key UNIQUE (project_id, request_id);

ALTER TABLE ONLY tasklattice.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.project_deletion_tasks
    ADD CONSTRAINT project_deletion_tasks_pkey PRIMARY KEY (project_id);

ALTER TABLE ONLY tasklattice.project_department_models
    ADD CONSTRAINT project_department_models_pkey PRIMARY KEY (project_id, resource_id);

ALTER TABLE ONLY tasklattice.project_department_routings
    ADD CONSTRAINT project_department_routings_pkey PRIMARY KEY (project_id, resource_id);

ALTER TABLE ONLY tasklattice.project_invitations
    ADD CONSTRAINT project_invitations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.project_invitations
    ADD CONSTRAINT project_invitations_project_id_email_key UNIQUE (project_id, email);

ALTER TABLE ONLY tasklattice.project_member_role_assignments
    ADD CONSTRAINT project_member_role_assignments_pkey PRIMARY KEY (project_id, user_id, role);

ALTER TABLE ONLY tasklattice.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (project_id, user_id);

ALTER TABLE ONLY tasklattice.project_quotas
    ADD CONSTRAINT project_quotas_pkey PRIMARY KEY (project_id);

ALTER TABLE ONLY tasklattice.project_runs
    ADD CONSTRAINT project_runs_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.project_runtime_targets
    ADD CONSTRAINT project_runtime_targets_pkey PRIMARY KEY (project_id);

ALTER TABLE ONLY tasklattice.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.provider_accounts
    ADD CONSTRAINT provider_accounts_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.role_capability_grants
    ADD CONSTRAINT role_capability_grants_pkey PRIMARY KEY (role_id, capability_id);

ALTER TABLE ONLY tasklattice.role_catalog_state
    ADD CONSTRAINT role_catalog_state_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.role_definitions
    ADD CONSTRAINT role_definitions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.sandbox_policies
    ADD CONSTRAINT sandbox_policies_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.skill_artifacts
    ADD CONSTRAINT skill_artifacts_digest_key UNIQUE (digest);

ALTER TABLE ONLY tasklattice.skill_artifacts
    ADD CONSTRAINT skill_artifacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.skill_artifacts
    ADD CONSTRAINT skill_artifacts_skill_version_key UNIQUE (skill_id, version);

ALTER TABLE ONLY tasklattice.skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (project_id, id);

ALTER TABLE ONLY tasklattice.user_notifications
    ADD CONSTRAINT user_notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY tasklattice.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tasklattice.users
    ADD CONSTRAINT users_username_key UNIQUE (username);

ALTER TABLE ONLY tasklattice.vector_document_revisions
    ADD CONSTRAINT vector_document_revisions_content_key UNIQUE (project_id, database_id, document_id, revision, content_hash);

ALTER TABLE ONLY tasklattice.vector_document_revisions
    ADD CONSTRAINT vector_document_revisions_pkey PRIMARY KEY (project_id, database_id, document_id, revision);

ALTER TABLE ONLY tasklattice.vector_documents
    ADD CONSTRAINT vector_documents_pkey PRIMARY KEY (project_id, database_id, id);

ALTER TABLE ONLY tasklattice.vector_folders
    ADD CONSTRAINT vector_folders_pkey PRIMARY KEY (project_id, database_id, id);

ALTER TABLE ONLY tasklattice.vector_ingestion_jobs
    ADD CONSTRAINT vector_ingestion_jobs_pkey PRIMARY KEY (id);

CREATE INDEX access_context_sessions_level_resource_idx ON tasklattice.access_context_sessions USING btree (level, resource_id);

CREATE INDEX access_policies_updated_idx ON tasklattice.access_policies USING btree (project_id, updated_at DESC);

CREATE INDEX access_policy_versions_created_idx ON tasklattice.access_policy_versions USING btree (project_id, policy_id, created_at DESC);

CREATE INDEX agent_catalog_project_owner_idx ON tasklattice.agent_catalog USING btree (project_id, owner_user_id);

CREATE INDEX agent_catalog_updated_idx ON tasklattice.agent_catalog USING btree (project_id, updated_at DESC);

CREATE INDEX agents_project_active_created_idx ON tasklattice.agents USING btree (project_id, deleted_at, created_at DESC);

CREATE INDEX agents_project_creator_idx ON tasklattice.agents USING btree (project_id, created_by_user_id);

CREATE INDEX agents_project_kind_catalog_idx ON tasklattice.agents USING btree (project_id, kind, catalog_agent_id);

CREATE INDEX agents_project_kind_developed_idx ON tasklattice.agents USING btree (project_id, kind, developed_agent_id);

CREATE UNIQUE INDEX agents_project_owner_creation_idempotency_key ON tasklattice.agents USING btree (project_id, owner_user_id, creation_idempotency_key);

CREATE INDEX agents_project_owner_idx ON tasklattice.agents USING btree (project_id, owner_user_id);

CREATE INDEX agents_project_version_idx ON tasklattice.agents USING btree (project_id, agent_version_id);

CREATE INDEX audit_logs_project_action_time_idx ON tasklattice.audit_logs USING btree (project_id, action, occurred_at DESC);

CREATE INDEX audit_logs_project_actor_time_idx ON tasklattice.audit_logs USING btree (project_id, actor_id, occurred_at DESC);

CREATE INDEX audit_logs_project_capability_idx ON tasklattice.audit_logs USING btree (project_id, authorization_capability, occurred_at DESC);

CREATE INDEX audit_logs_project_time_idx ON tasklattice.audit_logs USING btree (project_id, occurred_at DESC);

CREATE INDEX audit_logs_project_trace_idx ON tasklattice.audit_logs USING btree (project_id, trace_id);

CREATE INDEX audit_logs_retention_idx ON tasklattice.audit_logs USING btree (occurred_at DESC);

CREATE INDEX auth_accounts_user_id_idx ON tasklattice.auth_accounts USING btree (user_id);

CREATE INDEX auth_sessions_user_id_idx ON tasklattice.auth_sessions USING btree (user_id);

CREATE INDEX auth_verifications_identifier_idx ON tasklattice.auth_verifications USING btree (identifier);

CREATE INDEX capability_definitions_scope_sort_idx ON tasklattice.capability_definitions USING btree (scope, sort_order);

CREATE INDEX cost_attribution_hash_time_idx ON tasklattice.cost_attribution_mapping USING btree (project_id, hashed_token, valid_from, valid_to);

CREATE INDEX cost_attribution_key_time_idx ON tasklattice.cost_attribution_mapping USING btree (project_id, litellm_virtual_key_id, valid_from, valid_to);

CREATE INDEX cost_attribution_user_time_idx ON tasklattice.cost_attribution_mapping USING btree (project_id, litellm_user_id, valid_from, valid_to);

CREATE INDEX department_inference_resources_kind_idx ON tasklattice.department_inference_resources USING btree (department_id, kind, deleted_at, created_at DESC);

CREATE INDEX department_inference_resources_provider_idx ON tasklattice.department_inference_resources USING btree (department_id, provider_account_id);

CREATE INDEX department_members_user_role_status_idx ON tasklattice.department_members USING btree (user_id, role, status);

CREATE INDEX department_model_routing_audit_routing_idx ON tasklattice.department_model_routing_audit USING btree (department_id, model_routing_id, created_at DESC);

CREATE UNIQUE INDEX expert_agent_members_single_owner_key ON tasklattice.expert_agent_members USING btree (project_id, agent_id) WHERE (relation = 'OWNER'::tasklattice.expert_agent_relation);

CREATE INDEX expert_agent_members_user_relation_idx ON tasklattice.expert_agent_members USING btree (project_id, user_id, relation);

CREATE INDEX expert_agent_test_runs_agent_created_idx ON tasklattice.expert_agent_test_runs USING btree (project_id, agent_id, mode, created_at DESC);

CREATE UNIQUE INDEX expert_agent_test_runs_attempt_key ON tasklattice.expert_agent_test_runs USING btree (project_id, agent_id, agent_revision, mode, attempt);

CREATE INDEX expert_agent_test_runs_digest_status_idx ON tasklattice.expert_agent_test_runs USING btree (project_id, agent_id, content_digest, status);

CREATE UNIQUE INDEX expert_agent_version_artifacts_kind_digest_key ON tasklattice.expert_agent_version_artifacts USING btree (project_id, version_id, kind, digest);

CREATE INDEX expert_agent_version_artifacts_version_idx ON tasklattice.expert_agent_version_artifacts USING btree (project_id, version_id);

CREATE INDEX expert_agent_versions_agent_published_idx ON tasklattice.expert_agent_versions USING btree (project_id, agent_id, published_at DESC);

CREATE UNIQUE INDEX expert_agent_versions_digest_key ON tasklattice.expert_agent_versions USING btree (project_id, agent_id, content_digest);

CREATE UNIQUE INDEX expert_agent_versions_number_key ON tasklattice.expert_agent_versions USING btree (project_id, agent_id, version_number);

CREATE INDEX expert_agents_project_active_updated_idx ON tasklattice.expert_agents USING btree (project_id, deleted_at, updated_at DESC);

CREATE INDEX expert_agents_project_mode_updated_idx ON tasklattice.expert_agents USING btree (project_id, execution_mode, updated_at DESC);

CREATE UNIQUE INDEX expert_agents_project_slug_key ON tasklattice.expert_agents USING btree (project_id, slug);

CREATE INDEX external_role_bindings_subject_idx ON tasklattice.external_role_bindings USING btree (provider_id, subject_type, subject_value, enabled);

CREATE INDEX external_role_bindings_target_idx ON tasklattice.external_role_bindings USING btree (scope, department_id, project_id, role_id);

CREATE UNIQUE INDEX external_role_bindings_unique_mapping_idx ON tasklattice.external_role_bindings USING btree (provider_id, subject_type, subject_value, scope, COALESCE(department_id, ''::text), COALESCE(project_id, ''::text), role_id);

CREATE INDEX external_role_grants_user_seen_idx ON tasklattice.external_role_grants USING btree (user_id, last_seen_at);

CREATE INDEX instance_access_policy_policy_idx ON tasklattice.agent_instance_access_policy_bindings USING btree (project_id, access_policy_id);

CREATE INDEX instance_lifecycle_events_occurred_idx ON tasklattice.instance_lifecycle_events USING btree (project_id, occurred_at DESC);

CREATE INDEX instance_lifecycle_operations_instance_idx ON tasklattice.instance_lifecycle_operations USING btree (project_id, instance_id, created_at DESC);

CREATE UNIQUE INDEX instance_lifecycle_operations_queue_job_id_key ON tasklattice.instance_lifecycle_operations USING btree (queue_job_id);

CREATE INDEX instance_lifecycle_operations_status_idx ON tasklattice.instance_lifecycle_operations USING btree (project_id, status, updated_at DESC);

CREATE INDEX knowledge_vector_chunks_attributes_idx ON tasklattice.knowledge_vector_chunks USING gin (attributes);

CREATE INDEX knowledge_vector_chunks_database_idx ON tasklattice.knowledge_vector_chunks USING btree (project_id, database_id);

CREATE INDEX knowledge_vector_chunks_document_idx ON tasklattice.knowledge_vector_chunks USING btree (project_id, database_id, document_id, document_revision);

CREATE UNIQUE INDEX knowledge_vector_databases_dimensions_key ON tasklattice.knowledge_vector_databases USING btree (project_id, id, embedding_dimensions);

CREATE UNIQUE INDEX knowledge_vector_databases_vector_store_key ON tasklattice.knowledge_vector_databases USING btree (project_id, vector_store_id);

CREATE UNIQUE INDEX mcp_servers_litellm_server_id_key ON tasklattice.mcp_servers USING btree (litellm_server_id);

CREATE INDEX mcp_tools_project_id_mcp_server_id_idx ON tasklattice.mcp_tools USING btree (project_id, mcp_server_id);

CREATE INDEX memories_project_activity_idx ON tasklattice.memories USING btree (project_id, last_activity_at DESC);

CREATE UNIQUE INDEX memories_project_idempotency_key ON tasklattice.memories USING btree (project_id, idempotency_key);

CREATE UNIQUE INDEX memories_project_provider_ref_key ON tasklattice.memories USING btree (project_id, provider, provider_ref);

CREATE INDEX memories_project_status_updated_idx ON tasklattice.memories USING btree (project_id, status, updated_at DESC);

CREATE UNIQUE INDEX memory_bindings_active_primary_instance_key ON tasklattice.memory_bindings USING btree (project_id, instance_id) WHERE ((status = 'active'::tasklattice.memory_binding_status) AND (binding_kind = 'primary'::tasklattice.memory_binding_kind));

CREATE UNIQUE INDEX memory_bindings_active_primary_memory_key ON tasklattice.memory_bindings USING btree (project_id, memory_id) WHERE ((status = 'active'::tasklattice.memory_binding_status) AND (binding_kind = 'primary'::tasklattice.memory_binding_kind));

CREATE INDEX memory_bindings_instance_history_idx ON tasklattice.memory_bindings USING btree (project_id, instance_id, created_at DESC);

CREATE INDEX memory_bindings_memory_history_idx ON tasklattice.memory_bindings USING btree (project_id, memory_id, created_at DESC);

CREATE UNIQUE INDEX memory_bindings_project_idempotency_key ON tasklattice.memory_bindings USING btree (project_id, idempotency_key);

CREATE INDEX memory_curation_events_item_idx ON tasklattice.memory_curation_events USING btree (project_id, memory_id, provider_item_id);

CREATE INDEX memory_curation_events_memory_idx ON tasklattice.memory_curation_events USING btree (project_id, memory_id, created_at DESC);

CREATE INDEX memory_experience_projection_status_idx ON tasklattice.memory_experience_projections USING btree (project_id, memory_id, status, updated_at DESC);

CREATE INDEX memory_experience_projection_time_idx ON tasklattice.memory_experience_projections USING btree (project_id, memory_id, occurred_start DESC);

CREATE INDEX memory_outbox_due_idx ON tasklattice.memory_outbox USING btree (status, next_retry_at, created_at);

CREATE INDEX memory_outbox_memory_idx ON tasklattice.memory_outbox USING btree (project_id, memory_id, created_at DESC);

CREATE UNIQUE INDEX memory_outbox_project_idempotency_key ON tasklattice.memory_outbox USING btree (project_id, idempotency_key);

CREATE INDEX model_endpoint_group_time_idx ON tasklattice.model_endpoint_mapping USING btree (project_id, litellm_model_group, valid_from, valid_to);

CREATE INDEX model_endpoint_id_time_idx ON tasklattice.model_endpoint_mapping USING btree (project_id, litellm_model_id, valid_from, valid_to);

CREATE INDEX model_endpoint_name_time_idx ON tasklattice.model_endpoint_mapping USING btree (project_id, litellm_model_name, valid_from, valid_to);

CREATE INDEX model_routing_audit_routing_idx ON tasklattice.model_routing_audit USING btree (project_id, model_routing_id, created_at DESC);

CREATE INDEX model_routing_bindings_agent_idx ON tasklattice.model_routing_bindings USING btree (project_id, agent_id, created_at DESC);

CREATE INDEX model_routing_bindings_routing_idx ON tasklattice.model_routing_bindings USING btree (project_id, model_routing_id, created_at DESC);

CREATE INDEX model_usage_fact_run_time_idx ON tasklattice.model_usage_fact USING btree (project_id, run_id, request_start_time);

CREATE INDEX model_usage_fact_time_idx ON tasklattice.model_usage_fact USING btree (project_id, request_start_time);

CREATE INDEX project_deletion_tasks_due_idx ON tasklattice.project_deletion_tasks USING btree (status, next_attempt_at, scheduled_for);

CREATE INDEX project_deletion_tasks_lease_idx ON tasklattice.project_deletion_tasks USING btree (lease_expires_at);

CREATE UNIQUE INDEX project_deletion_tasks_queue_job_id_key ON tasklattice.project_deletion_tasks USING btree (queue_job_id);

CREATE UNIQUE INDEX project_department_models_default_idx ON tasklattice.project_department_models USING btree (project_id, default_for) WHERE (default_for IS NOT NULL);

CREATE INDEX project_department_models_resource_idx ON tasklattice.project_department_models USING btree (department_id, resource_id);

CREATE INDEX project_department_routings_default_idx ON tasklattice.project_department_routings USING btree (project_id, is_default);

CREATE UNIQUE INDEX project_department_routings_one_default_idx ON tasklattice.project_department_routings USING btree (project_id) WHERE (is_default = true);

CREATE INDEX project_department_routings_resource_idx ON tasklattice.project_department_routings USING btree (department_id, resource_id);

CREATE INDEX project_member_role_assignments_project_role_idx ON tasklattice.project_member_role_assignments USING btree (project_id, role);

CREATE INDEX project_runs_expert_agent_version_started_idx ON tasklattice.project_runs USING btree (project_id, expert_agent_id, expert_agent_version_id, started_at DESC);

CREATE INDEX project_runs_project_instance_started_idx ON tasklattice.project_runs USING btree (project_id, instance_id, started_at DESC);

CREATE INDEX project_runs_project_started_idx ON tasklattice.project_runs USING btree (project_id, started_at DESC);

CREATE INDEX project_runs_project_status_started_idx ON tasklattice.project_runs USING btree (project_id, status, started_at DESC);

CREATE UNIQUE INDEX project_runs_runtime_id_key ON tasklattice.project_runs USING btree (project_id, instance_id, source, external_run_id);

CREATE INDEX project_runtime_targets_due_idx ON tasklattice.project_runtime_targets USING btree (status, next_attempt_at);

CREATE INDEX project_runtime_targets_lease_idx ON tasklattice.project_runtime_targets USING btree (lease_expires_at);

CREATE UNIQUE INDEX project_runtime_targets_namespace_key ON tasklattice.project_runtime_targets USING btree (namespace);

CREATE INDEX projects_active_created_idx ON tasklattice.projects USING btree (deleted_at, created_at);

CREATE INDEX projects_department_created_idx ON tasklattice.projects USING btree (department_id, created_at);

CREATE UNIQUE INDEX projects_department_name_key ON tasklattice.projects USING btree (department_id, name);

CREATE INDEX role_capability_grants_capability_idx ON tasklattice.role_capability_grants USING btree (capability_id);

CREATE INDEX role_definitions_family_sort_idx ON tasklattice.role_definitions USING btree (family, sort_order);

CREATE INDEX role_definitions_scope_sort_idx ON tasklattice.role_definitions USING btree (scope, sort_order);

CREATE INDEX skill_artifacts_skill_id_idx ON tasklattice.skill_artifacts USING btree (skill_id);

CREATE INDEX user_notifications_user_created_idx ON tasklattice.user_notifications USING btree (user_id, created_at DESC);

CREATE INDEX user_notifications_user_unread_idx ON tasklattice.user_notifications USING btree (user_id, read_at);

CREATE INDEX vector_documents_database_status_idx ON tasklattice.vector_documents USING btree (project_id, database_id, status, updated_at);

CREATE INDEX vector_documents_directory_idx ON tasklattice.vector_documents USING btree (project_id, database_id, directory_path);

CREATE INDEX vector_documents_folder_idx ON tasklattice.vector_documents USING btree (project_id, database_id, folder_id, updated_at DESC);

CREATE INDEX vector_folders_parent_idx ON tasklattice.vector_folders USING btree (project_id, database_id, parent_id, updated_at DESC);

CREATE UNIQUE INDEX vector_folders_parent_name_key ON tasklattice.vector_folders USING btree (project_id, database_id, parent_id, name) WHERE (parent_id IS NOT NULL);

CREATE UNIQUE INDEX vector_folders_root_name_key ON tasklattice.vector_folders USING btree (project_id, database_id, name) WHERE (parent_id IS NULL);

CREATE INDEX vector_ingestion_jobs_database_idx ON tasklattice.vector_ingestion_jobs USING btree (project_id, database_id, created_at);

CREATE INDEX vector_ingestion_jobs_status_idx ON tasklattice.vector_ingestion_jobs USING btree (project_id, status, updated_at);

CREATE TRIGGER agents_developed_version_guard BEFORE INSERT OR UPDATE ON tasklattice.agents FOR EACH ROW EXECUTE FUNCTION tasklattice.validate_agent_instance_version_reference();

CREATE TRIGGER expert_agent_version_artifacts_immutable_update BEFORE UPDATE ON tasklattice.expert_agent_version_artifacts FOR EACH ROW EXECUTE FUNCTION tasklattice.reject_agent_version_update();

CREATE TRIGGER expert_agent_versions_immutable_update BEFORE UPDATE ON tasklattice.expert_agent_versions FOR EACH ROW EXECUTE FUNCTION tasklattice.reject_agent_version_update();

CREATE TRIGGER expert_agents_latest_release_guard BEFORE INSERT OR UPDATE ON tasklattice.expert_agents FOR EACH ROW EXECUTE FUNCTION tasklattice.validate_agent_release_reference();

CREATE TRIGGER projects_name_immutable BEFORE UPDATE OF name ON tasklattice.projects FOR EACH ROW EXECUTE FUNCTION tasklattice.prevent_project_name_change();

ALTER TABLE ONLY tasklattice.access_context_sessions
    ADD CONSTRAINT access_context_sessions_session_fkey FOREIGN KEY (session_id) REFERENCES tasklattice.auth_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.access_policies
    ADD CONSTRAINT access_policies_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.access_policy_versions
    ADD CONSTRAINT access_policy_versions_policy_fkey FOREIGN KEY (project_id, policy_id) REFERENCES tasklattice.access_policies(project_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.access_policy_versions
    ADD CONSTRAINT access_policy_versions_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.agent_catalog
    ADD CONSTRAINT agent_catalog_owner_membership_fkey FOREIGN KEY (project_id, owner_user_id) REFERENCES tasklattice.project_members(project_id, user_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.agent_catalog
    ADD CONSTRAINT agent_catalog_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.agent_instance_access_policy_bindings
    ADD CONSTRAINT agent_instance_access_policy_instance_fkey FOREIGN KEY (project_id, instance_id) REFERENCES tasklattice.agents(project_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.agent_instance_access_policy_bindings
    ADD CONSTRAINT agent_instance_access_policy_policy_fkey FOREIGN KEY (project_id, access_policy_id) REFERENCES tasklattice.access_policies(project_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.agent_instance_access_policy_bindings
    ADD CONSTRAINT agent_instance_access_policy_project_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.agent_specializations
    ADD CONSTRAINT agent_specializations_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.agents
    ADD CONSTRAINT agents_agent_version_fkey FOREIGN KEY (project_id, agent_version_id) REFERENCES tasklattice.expert_agent_versions(project_id, id) ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.agents
    ADD CONSTRAINT agents_catalog_agent_fkey FOREIGN KEY (project_id, catalog_agent_id) REFERENCES tasklattice.agent_catalog(project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.agents
    ADD CONSTRAINT agents_creator_membership_fkey FOREIGN KEY (project_id, created_by_user_id) REFERENCES tasklattice.project_members(project_id, user_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.agents
    ADD CONSTRAINT agents_developed_agent_fkey FOREIGN KEY (project_id, developed_agent_id) REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.agents
    ADD CONSTRAINT agents_owner_membership_fkey FOREIGN KEY (project_id, owner_user_id) REFERENCES tasklattice.project_members(project_id, user_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.agents
    ADD CONSTRAINT agents_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.audit_logs
    ADD CONSTRAINT audit_logs_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY tasklattice.auth_accounts
    ADD CONSTRAINT auth_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES tasklattice.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES tasklattice.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.cost_attribution_mapping
    ADD CONSTRAINT cost_attribution_mapping_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.cost_sync_checkpoint
    ADD CONSTRAINT cost_sync_checkpoint_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.department_inference_resources
    ADD CONSTRAINT department_inference_resources_department_fkey FOREIGN KEY (department_id) REFERENCES tasklattice.departments(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.department_members
    ADD CONSTRAINT department_members_department_id_fkey FOREIGN KEY (department_id) REFERENCES tasklattice.departments(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.department_members
    ADD CONSTRAINT department_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES tasklattice.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.department_model_routing_audit
    ADD CONSTRAINT department_model_routing_audit_department_fkey FOREIGN KEY (department_id) REFERENCES tasklattice.departments(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.departments
    ADD CONSTRAINT departments_created_by_fkey FOREIGN KEY (created_by) REFERENCES tasklattice.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.expert_agent_members
    ADD CONSTRAINT expert_agent_members_agent_fkey FOREIGN KEY (project_id, agent_id) REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.expert_agent_members
    ADD CONSTRAINT expert_agent_members_project_membership_fkey FOREIGN KEY (project_id, user_id) REFERENCES tasklattice.project_members(project_id, user_id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.expert_agent_test_runs
    ADD CONSTRAINT expert_agent_test_runs_agent_fkey FOREIGN KEY (project_id, agent_id) REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.expert_agent_version_artifacts
    ADD CONSTRAINT expert_agent_version_artifacts_version_fkey FOREIGN KEY (project_id, version_id) REFERENCES tasklattice.expert_agent_versions(project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.expert_agent_versions
    ADD CONSTRAINT expert_agent_versions_agent_fkey FOREIGN KEY (project_id, agent_id) REFERENCES tasklattice.expert_agents(project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.expert_agents
    ADD CONSTRAINT expert_agents_creator_membership_fkey FOREIGN KEY (project_id, created_by) REFERENCES tasklattice.project_members(project_id, user_id) ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.expert_agents
    ADD CONSTRAINT expert_agents_latest_released_version_fkey FOREIGN KEY (project_id, latest_released_version_id) REFERENCES tasklattice.expert_agent_versions(project_id, id);

ALTER TABLE ONLY tasklattice.expert_agents
    ADD CONSTRAINT expert_agents_project_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.expert_agents
    ADD CONSTRAINT expert_agents_updater_membership_fkey FOREIGN KEY (project_id, updated_by) REFERENCES tasklattice.project_members(project_id, user_id) ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.external_role_bindings
    ADD CONSTRAINT external_role_bindings_department_fkey FOREIGN KEY (department_id) REFERENCES tasklattice.departments(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.external_role_bindings
    ADD CONSTRAINT external_role_bindings_project_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.external_role_grants
    ADD CONSTRAINT external_role_grants_binding_fkey FOREIGN KEY (binding_id) REFERENCES tasklattice.external_role_bindings(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.external_role_grants
    ADD CONSTRAINT external_role_grants_user_fkey FOREIGN KEY (user_id) REFERENCES tasklattice.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.inference_gateways
    ADD CONSTRAINT inference_gateways_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.instance_lifecycle_events
    ADD CONSTRAINT instance_lifecycle_events_operation_fkey FOREIGN KEY (project_id, operation_id) REFERENCES tasklattice.instance_lifecycle_operations(project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.instance_lifecycle_events
    ADD CONSTRAINT instance_lifecycle_events_project_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.instance_lifecycle_operations
    ADD CONSTRAINT instance_lifecycle_operations_instance_fkey FOREIGN KEY (project_id, instance_id) REFERENCES tasklattice.agents(project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.instance_lifecycle_operations
    ADD CONSTRAINT instance_lifecycle_operations_project_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.knowledge_sources
    ADD CONSTRAINT knowledge_sources_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.knowledge_vector_chunks
    ADD CONSTRAINT knowledge_vector_chunks_database_fkey FOREIGN KEY (project_id, database_id, embedding_dimensions) REFERENCES tasklattice.knowledge_vector_databases(project_id, id, embedding_dimensions) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.knowledge_vector_chunks
    ADD CONSTRAINT knowledge_vector_chunks_document_fkey FOREIGN KEY (project_id, database_id, document_id, document_revision) REFERENCES tasklattice.vector_document_revisions(project_id, database_id, document_id, revision) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.knowledge_vector_databases
    ADD CONSTRAINT knowledge_vector_databases_project_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.knowledge_vector_databases
    ADD CONSTRAINT knowledge_vector_databases_source_fkey FOREIGN KEY (project_id, id) REFERENCES tasklattice.knowledge_sources(project_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.mcp_servers
    ADD CONSTRAINT mcp_servers_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.mcp_tools
    ADD CONSTRAINT mcp_tools_server_fkey FOREIGN KEY (project_id, mcp_server_id) REFERENCES tasklattice.mcp_servers(project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.memories
    ADD CONSTRAINT memories_project_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.memory_bindings
    ADD CONSTRAINT memory_bindings_instance_fkey FOREIGN KEY (project_id, instance_id) REFERENCES tasklattice.agents(project_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.memory_bindings
    ADD CONSTRAINT memory_bindings_memory_fkey FOREIGN KEY (project_id, memory_id) REFERENCES tasklattice.memories(project_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.memory_curation_events
    ADD CONSTRAINT memory_curation_events_memory_fkey FOREIGN KEY (project_id, memory_id) REFERENCES tasklattice.memories(project_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.memory_experience_projections
    ADD CONSTRAINT memory_experience_projections_memory_fkey FOREIGN KEY (project_id, memory_id) REFERENCES tasklattice.memories(project_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.memory_outbox
    ADD CONSTRAINT memory_outbox_memory_fkey FOREIGN KEY (project_id, memory_id) REFERENCES tasklattice.memories(project_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.model_deployments
    ADD CONSTRAINT model_deployments_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.model_deployments
    ADD CONSTRAINT model_deployments_project_id_provider_account_id_fkey FOREIGN KEY (project_id, provider_account_id) REFERENCES tasklattice.provider_accounts(project_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.model_endpoint_mapping
    ADD CONSTRAINT model_endpoint_mapping_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.model_routing_audit
    ADD CONSTRAINT model_profile_audit_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.model_routing_bindings
    ADD CONSTRAINT model_profile_bindings_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.model_routings
    ADD CONSTRAINT model_profiles_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.model_usage_daily
    ADD CONSTRAINT model_usage_daily_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.model_usage_fact_observation
    ADD CONSTRAINT model_usage_fact_observation_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.model_usage_fact
    ADD CONSTRAINT model_usage_fact_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.project_deletion_tasks
    ADD CONSTRAINT project_deletion_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.project_department_models
    ADD CONSTRAINT project_department_models_project_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.project_department_models
    ADD CONSTRAINT project_department_models_resource_fkey FOREIGN KEY (department_id, resource_id) REFERENCES tasklattice.department_inference_resources(department_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.project_department_routings
    ADD CONSTRAINT project_department_routings_project_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.project_department_routings
    ADD CONSTRAINT project_department_routings_resource_fkey FOREIGN KEY (department_id, resource_id) REFERENCES tasklattice.department_inference_resources(department_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.project_invitations
    ADD CONSTRAINT project_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES tasklattice.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.project_invitations
    ADD CONSTRAINT project_invitations_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.project_member_role_assignments
    ADD CONSTRAINT project_member_role_assignments_member_fkey FOREIGN KEY (project_id, user_id) REFERENCES tasklattice.project_members(project_id, user_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.project_members
    ADD CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.project_members
    ADD CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES tasklattice.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.project_quotas
    ADD CONSTRAINT project_quotas_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.project_runs
    ADD CONSTRAINT project_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.project_runtime_targets
    ADD CONSTRAINT project_runtime_targets_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.projects
    ADD CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES tasklattice.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.projects
    ADD CONSTRAINT projects_department_id_fkey FOREIGN KEY (department_id) REFERENCES tasklattice.departments(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.provider_accounts
    ADD CONSTRAINT provider_accounts_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.role_capability_grants
    ADD CONSTRAINT role_capability_grants_capability_fkey FOREIGN KEY (capability_id) REFERENCES tasklattice.capability_definitions(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.role_capability_grants
    ADD CONSTRAINT role_capability_grants_role_fkey FOREIGN KEY (role_id) REFERENCES tasklattice.role_definitions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.sandbox_policies
    ADD CONSTRAINT sandbox_policies_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.skills
    ADD CONSTRAINT skills_project_id_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.user_notifications
    ADD CONSTRAINT user_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES tasklattice.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.vector_document_revisions
    ADD CONSTRAINT vector_document_revisions_document_fkey FOREIGN KEY (project_id, database_id, document_id) REFERENCES tasklattice.vector_documents(project_id, database_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.vector_documents
    ADD CONSTRAINT vector_documents_database_fkey FOREIGN KEY (project_id, database_id) REFERENCES tasklattice.knowledge_vector_databases(project_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.vector_documents
    ADD CONSTRAINT vector_documents_folder_fkey FOREIGN KEY (project_id, database_id, folder_id) REFERENCES tasklattice.vector_folders(project_id, database_id, id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tasklattice.vector_documents
    ADD CONSTRAINT vector_documents_project_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.vector_folders
    ADD CONSTRAINT vector_folders_database_fkey FOREIGN KEY (project_id, database_id) REFERENCES tasklattice.knowledge_vector_databases(project_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.vector_folders
    ADD CONSTRAINT vector_folders_parent_fkey FOREIGN KEY (project_id, database_id, parent_id) REFERENCES tasklattice.vector_folders(project_id, database_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.vector_ingestion_jobs
    ADD CONSTRAINT vector_ingestion_jobs_database_fkey FOREIGN KEY (project_id, database_id) REFERENCES tasklattice.knowledge_vector_databases(project_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.vector_ingestion_jobs
    ADD CONSTRAINT vector_ingestion_jobs_document_fkey FOREIGN KEY (project_id, database_id, document_id) REFERENCES tasklattice.vector_documents(project_id, database_id, id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.vector_ingestion_jobs
    ADD CONSTRAINT vector_ingestion_jobs_project_fkey FOREIGN KEY (project_id) REFERENCES tasklattice.projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tasklattice.vector_ingestion_jobs
    ADD CONSTRAINT vector_ingestion_jobs_revision_fkey FOREIGN KEY (project_id, database_id, document_id, revision) REFERENCES tasklattice.vector_document_revisions(project_id, database_id, document_id, revision) ON UPDATE CASCADE ON DELETE CASCADE;

-- Registration receipts and retryable compensation for external side effects.
CREATE TABLE tasklattice.provider_registration_receipts (
    scope text NOT NULL,
    key text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (scope, key)
);

CREATE TABLE tasklattice.provider_registration_cleanup (
    id uuid NOT NULL PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('MODEL', 'SECRET')),
    resource_id text NOT NULL,
    next_attempt_at timestamp(6) with time zone NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX provider_registration_cleanup_due_idx ON tasklattice.provider_registration_cleanup (next_attempt_at);

CREATE UNIQUE INDEX model_deployments_active_model_key ON tasklattice.model_deployments (project_id, provider_account_id, (payload->>'modelId'), (payload->>'modelType')) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX department_models_active_model_key ON tasklattice.department_inference_resources (department_id, provider_account_id, (payload->>'modelId'), (payload->>'modelType')) WHERE kind = 'MODEL' AND deleted_at IS NULL;

-- Durable Worker operations for Project and Agent Garden resources.
CREATE TABLE "tasklattice"."resource_operations" (
  id UUID PRIMARY KEY, project_id TEXT NOT NULL REFERENCES tasklattice.projects(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL, action TEXT NOT NULL, input_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', result JSONB, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX resource_operations_project_status_idx ON tasklattice.resource_operations(project_id, status);
