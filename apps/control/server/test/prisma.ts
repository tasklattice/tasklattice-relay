import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type Client as PgClient } from "pg";
import migration from "../../prisma/migrations/20260723000000_initial_control_plane/migration.sql?raw";
import seedMigration from "../../prisma/migrations/20260723001000_seed_control_plane/migration.sql?raw";
import virtualEmployeeMigration from "../../prisma/migrations/20260724000000_virtual_employees/migration.sql?raw";
import projectQuotaMigration from "../../prisma/migrations/20260725000000_project_quotas/migration.sql?raw";
import personalProfileMigration from "../../prisma/migrations/20260725120000_personal_profile/migration.sql?raw";
import accountPreferencesMigration from "../../prisma/migrations/20260725130000_account_preferences/migration.sql?raw";
import betterAuthMigration from "../../prisma/migrations/20260725140000_better_auth/migration.sql?raw";
import resourceCatalogNamesMigration from "../../prisma/migrations/20260725150000_resource_catalog_names/migration.sql?raw";
import mcpToolDiscoveryMigration from "../../prisma/migrations/20260725160000_mcp_tool_discovery/migration.sql?raw";
import liteLLMResourceControlPlaneMigration from "../../prisma/migrations/20260725190000_litellm_resource_control_plane/migration.sql?raw";
import accessPoliciesMigration from "../../prisma/migrations/20260725200000_access_policies/migration.sql?raw";
import auditLogsMigration from "../../prisma/migrations/20260726120000_platform_audit_logs/migration.sql?raw";
import agentGardenMigration from "../../prisma/migrations/20260726150000_agent_garden/migration.sql?raw";
import vendorSkillArtifactsMigration from "../../prisma/migrations/20260726230000_vendor_skill_artifacts/migration.sql?raw";
import auditLogQueryAndTraceMigration from "../../prisma/migrations/20260727090000_audit_log_query_and_trace/migration.sql?raw";
import auditFixtureTraceCorrelationMigration from "../../prisma/migrations/20260727091000_audit_fixture_trace_correlation/migration.sql?raw";
import realAuditCaptureMigration from "../../prisma/migrations/20260727100000_real_audit_capture_and_project_soft_delete/migration.sql?raw";
import instanceAccessPolicyBindingsMigration from "../../prisma/migrations/20260802000000_instance_access_policy_bindings/migration.sql?raw";
import defaultAccessPolicyMigration from "../../prisma/migrations/20260803000000_default_access_policy/migration.sql?raw";
import reconcileSpecializationCapabilitiesMigration from "../../prisma/migrations/20260803010000_reconcile_specialization_capabilities/migration.sql?raw";
import modelRoutingDomainMigration from "../../prisma/migrations/20260803020000_model_routing_domain/migration.sql?raw";
import capabilityAdmissionMigration from "../../prisma/migrations/20260812000000_project_capability_admission/migration.sql?raw";
import projectRunMetricsMigration from "../../prisma/migrations/20260813000000_project_run_metrics/migration.sql?raw";
import removeProjectTypeMigration from "../../prisma/migrations/20260813000000_remove_project_type/migration.sql?raw";
import projectBudgetWindowsMigration from "../../prisma/migrations/20260813010000_project_budget_windows/migration.sql?raw";
import modelUsageRunCorrelationMigration from "../../prisma/migrations/20260813020000_model_usage_run_correlation/migration.sql?raw";
import removeBusinessEnvironmentsMigration from "../../prisma/migrations/20260813030000_remove_business_environments/migration.sql?raw";
import accountLanguageAndNotificationsMigration from "../../prisma/migrations/20260813040000_account_language_and_notifications/migration.sql?raw";
import projectRoleSessionsMigration from "../../prisma/migrations/20260813050000_project_role_sessions/migration.sql?raw";
import directProjectRoleSwitchingMigration from "../../prisma/migrations/20260813060000_direct_project_role_switching/migration.sql?raw";
import projectDeletionTasksMigration from "../../prisma/migrations/20260815000000_project_deletion_tasks/migration.sql?raw";
import departmentsMigration from "../../prisma/migrations/20260819000000_departments/migration.sql?raw";
import departmentRolesMigration from "../../prisma/migrations/20260820000000_department_roles/migration.sql?raw";
import projectRuntimeTargetsMigration from "../../prisma/migrations/20260822000000_project_runtime_targets/migration.sql?raw";
import managedA2aInstancesMigration from "../../prisma/migrations/20260823000000_managed_a2a_instances/migration.sql?raw";
import platformSettingsMigration from "../../prisma/migrations/20260824000000_platform_settings/migration.sql?raw";
import platformAuthSettingsMigration from "../../prisma/migrations/20260824010000_platform_auth_settings/migration.sql?raw";
import platformEmailAndRuntimePolicyMigration from "../../prisma/migrations/20260824020000_platform_email_and_runtime_policy/migration.sql?raw";
import platformSandboxDefaultsMigration from "../../prisma/migrations/20260824030000_platform_sandbox_defaults/migration.sql?raw";
import ssoRoleBindingsMigration from "../../prisma/migrations/20260824040000_sso_role_bindings/migration.sql?raw";
import builtinRoleCatalogMigration from "../../prisma/migrations/20260824050000_builtin_role_catalog/migration.sql?raw";
import departmentSettingsMigration from "../../prisma/migrations/20260824060000_department_settings/migration.sql?raw";
import compactSsoGroupPathsMigration from "../../prisma/migrations/20260824070000_compact_sso_group_paths/migration.sql?raw";
import platformRuntimeSettingsMigration from "../../prisma/migrations/20260825000000_platform_runtime_settings/migration.sql?raw";
import businessRecordSoftDeleteMigration from "../../prisma/migrations/20260826000000_business_record_soft_delete/migration.sql?raw";
import unifiedAgentInstancesMigration from "../../prisma/migrations/20260826010000_unify_agent_instances_and_runtime_settings/migration.sql?raw";
import departmentInferenceResourcesMigration from "../../prisma/migrations/20260826030000_department_inference_resources/migration.sql?raw";
import controlWorkerQueueMigration from "../../prisma/migrations/20260827000000_control_worker_queue/migration.sql?raw";
import accessContextSessionsMigration from "../../prisma/migrations/20260827010000_access_context_sessions/migration.sql?raw";
import knowledgeVectorDatabaseMigration from "../../prisma/migrations/20260827020000_knowledge_vector_database/migration.sql?raw";
import departmentResourceAssignmentsMigration from "../../prisma/migrations/20260827030000_department_resource_assignments/migration.sql?raw";
import vectorDatabaseDocumentsMigration from "../../prisma/migrations/20260827120000_vector_database_documents/migration.sql?raw";
import vectorDocumentDirectoriesMigration from "../../prisma/migrations/20260827130000_vector_document_directories/migration.sql?raw";
import vectorDatabaseFoldersMigration from "../../prisma/migrations/20260827140000_vector_database_folders/migration.sql?raw";
import vectorDocumentMetadataMigration from "../../prisma/migrations/20260827200000_vector_document_metadata/migration.sql?raw";
import projectDurableMemoryMigration from "../../prisma/migrations/20260828000000_project_durable_memory/migration.sql?raw";
import memoryAgentIdempotencyMigration from "../../prisma/migrations/20260828010000_memory_agent_idempotency/migration.sql?raw";
import instanceLifecycleOperationsMigration from "../../prisma/migrations/20260828030000_instance_lifecycle_operations/migration.sql?raw";
import expertAgentDeliveryLifecycleMigration from "../../prisma/migrations/20260830000000_expert_agent_delivery_lifecycle/migration.sql?raw";
import expertAgentContractPolicyMigration from "../../prisma/migrations/20260830010000_expert_agent_contract_policy/migration.sql?raw";
import expertAgentDelegationTopologyMigration from "../../prisma/migrations/20260830020000_expert_agent_delegation_topology/migration.sql?raw";
import expertAgentEvaluationTracesMigration from "../../prisma/migrations/20260830030000_expert_agent_evaluation_traces/migration.sql?raw";
import expertAgentWorkingCopyEvaluationsMigration from "../../prisma/migrations/20260830040000_expert_agent_working_copy_evaluations/migration.sql?raw";
import runtimeInventoryOwnershipMigration from "../../prisma/migrations/20260830050000_runtime_inventory_ownership/migration.sql?raw";
import agentVersionArtifactsMigration from "../../prisma/migrations/20260831000000_agent_version_artifacts/migration.sql?raw";
import { developmentResourceCatalog } from "../catalog/development-resource-catalog";
import { PrismaClient } from "../generated/prisma/client";

export function createTestPrisma(): PrismaClient {
  const require = createRequire(import.meta.url);
  const { DataType, newDb } = require("pg-mem") as typeof import("pg-mem");
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerFunction({
    name: "to_timestamp",
    args: [DataType.integer],
    returns: DataType.timestamptz,
    implementation: (seconds: number) => new Date(seconds * 1_000),
  });
  memory.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: () => 1,
  });
  memory.public.registerFunction({
    name: "md5",
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string) =>
      createHash("md5").update(value).digest("hex"),
  });
  memory.public.registerFunction({
    name: "char_length",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (value: string) => value.length,
  });
  memory.public.registerFunction({
    name: "btrim",
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string) => value.trim(),
  });
  memory.public.registerFunction({
    name: "jsonb_typeof",
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: (value: unknown) => {
      if (value === null) return "null";
      if (Array.isArray(value)) return "array";
      return typeof value;
    },
  });
  // pg-mem models NUMERIC values but does not parse PostgreSQL precision
  // metadata. Production migrations retain Prisma's DECIMAL(65,30).
  const testInitialMigration = migration.replace("'approver'", "'reviewer'");
  if (
    !testInitialMigration.includes(
      "ENUM ('admin', 'auditor', 'developer', 'user', 'reviewer')",
    )
    || testInitialMigration.includes("'member'")
    || testInitialMigration.includes("'end_user'")
    || !testInitialMigration.includes("owner_user_id TEXT NOT NULL")
    || !testInitialMigration.includes("agents_owner_membership_fkey")
  ) {
    throw new Error("Initial Project role and Agent ownership schema is incomplete.");
  }
  memory.public.none(testInitialMigration.replaceAll("DECIMAL(65,30)", "NUMERIC"));
  memory.public.none(seedMigration);
  memory.public.none(virtualEmployeeMigration.replaceAll("DECIMAL(18,6)", "NUMERIC"));
  memory.public.none(projectQuotaMigration.replaceAll("DECIMAL(18,6)", "NUMERIC"));
  memory.public.none(personalProfileMigration);
  memory.public.none(accountPreferencesMigration);
  memory.public.none(
    betterAuthMigration
      .replaceAll("super_administrator", "platform_administrator")
      .replace(
        /CREATE INDEX auth_(?:sessions_user_id|accounts_user_id|verifications_identifier)_idx[\s\S]*?;/g,
        "",
      ),
  );
  memory.public.none(
    resourceCatalogNamesMigration.replace(
      /ALTER TABLE tasklattice\.(?:skills|mcp_servers|knowledge_sources)\s+RENAME CONSTRAINT[\s\S]*?;/g,
      "",
    ),
  );
  memory.public.none(mcpToolDiscoveryMigration);
  memory.public.none(liteLLMResourceControlPlaneMigration);
  memory.public.none(accessPoliciesMigration);
  memory.public.none(auditLogsMigration);
  if (
    !agentGardenMigration.includes("agent_catalog_owner_membership_fkey")
    || !agentGardenMigration.includes("agent_catalog_owner_kind_check")
    || !agentGardenMigration.includes("agent_catalog_project_owner_idx")
  ) {
    throw new Error("Agent Garden ownership schema is incomplete.");
  }
  memory.public.none(agentGardenMigration);
  memory.public.none(vendorSkillArtifactsMigration);
  memory.public.none(auditLogQueryAndTraceMigration);
  memory.public.none(auditFixtureTraceCorrelationMigration);
  memory.public.none(realAuditCaptureMigration);
  const instancePolicyTable = instanceAccessPolicyBindingsMigration.match(
    /CREATE TABLE tasklattice\.agent_instance_access_policy_bindings[\s\S]*?\n\);/,
  )?.[0];
  const instancePolicyIndex = instanceAccessPolicyBindingsMigration.match(
    /CREATE INDEX instance_access_policy_policy_idx[\s\S]*?;/,
  )?.[0];
  const removedVirtualEmployeeTables = [
    ...instanceAccessPolicyBindingsMigration.matchAll(
      /^DROP TABLE tasklattice\.(?:virtual_employee_audit|agent_instance_virtual_employee_bindings|access_scope_bindings|identity_bindings|virtual_employee_model_access|virtual_employees);$/gm,
    ),
  ].map(([statement]) => statement);
  if (!instancePolicyTable || !instancePolicyIndex || removedVirtualEmployeeTables.length !== 6) {
    throw new Error("Instance Access Policy migration structure is incomplete.");
  }
  // pg-mem does not implement the PostgreSQL JSONB lateral expansion and DO
  // blocks used by the production backfill. The test seed has no Instances or
  // Access Policies, so applying the equivalent structural migration is exact.
  memory.public.none(
    [instancePolicyTable, instancePolicyIndex, ...removedVirtualEmployeeTables].join("\n"),
  );
  const defaultAccessPolicyId = "00000000-0000-4000-8000-00000000da12";
  if (
    !defaultAccessPolicyMigration.includes(defaultAccessPolicyId)
    || !defaultAccessPolicyMigration.includes("'serverRules', '[]'::jsonb")
    || !defaultAccessPolicyMigration.includes("'status', 'ACTIVE'")
  ) {
    throw new Error("Default Access Policy migration structure is incomplete.");
  }
  // pg-mem does not implement the PostgreSQL DO and JSONB builder functions
  // used by the production migration. Apply its equivalent seed data here.
  const defaultAccessPolicyCreatedAt = "2026-08-03T00:00:00.000Z";
  const defaultAccessPolicy = {
    id: defaultAccessPolicyId,
    name: "Default",
    status: "ACTIVE",
    serverRules: [],
    revision: 1,
    createdBy: "system:setup",
    createdAt: defaultAccessPolicyCreatedAt,
    updatedAt: defaultAccessPolicyCreatedAt,
  };
  const defaultAccessPolicyVersion = {
    policyId: defaultAccessPolicyId,
    revision: 1,
    actor: "system:setup",
    summary: "Default deny-all Access Policy created during Project setup.",
    snapshot: defaultAccessPolicy,
    createdAt: defaultAccessPolicyCreatedAt,
  };
  memory.public.none(`
    INSERT INTO tasklattice.access_policies (
      project_id, id, payload, created_at, updated_at
    )
    SELECT
      project.id,
      '${defaultAccessPolicyId}',
      '${JSON.stringify(defaultAccessPolicy)}'::jsonb,
      '${defaultAccessPolicyCreatedAt}'::timestamptz,
      '${defaultAccessPolicyCreatedAt}'::timestamptz
    FROM tasklattice.projects AS project
    WHERE project.deleted_at IS NULL;

    INSERT INTO tasklattice.access_policy_versions (
      project_id, policy_id, revision, payload, created_at
    )
    SELECT
      project.id,
      '${defaultAccessPolicyId}',
      1,
      '${JSON.stringify(defaultAccessPolicyVersion)}'::jsonb,
      '${defaultAccessPolicyCreatedAt}'::timestamptz
    FROM tasklattice.projects AS project
      WHERE project.deleted_at IS NULL;
  `);
  if (
    !reconcileSpecializationCapabilitiesMigration.includes(
      "defaultMcpServerIds",
    ) ||
    !reconcileSpecializationCapabilitiesMigration.includes(
      "defaultKnowledgeSourceIds",
    ) ||
    !reconcileSpecializationCapabilitiesMigration.includes(
      "tasklattice.mcp_servers",
    ) ||
    !reconcileSpecializationCapabilitiesMigration.includes(
      "tasklattice.knowledge_sources",
    )
  ) {
    throw new Error("Role capability reconciliation migration is incomplete.");
  }
  // pg-mem does not implement the correlated JSONB expansion used by the
  // production migration. Reconcile the same references in JavaScript.
  const resourceIds = (table: "skills" | "mcp_servers" | "knowledge_sources") =>
    new Set(
      memory.public
        .many(`SELECT project_id, id FROM tasklattice.${table}`)
        .map((row) => `${String(row.project_id)}:${String(row.id)}`),
    );
  const availableSkillIds = resourceIds("skills");
  const availableMcpServerIds = resourceIds("mcp_servers");
  const availableKnowledgeSourceIds = resourceIds("knowledge_sources");
  for (const row of memory.public.many(
    "SELECT project_id, id, payload FROM tasklattice.agent_specializations",
  )) {
    const projectId = String(row.project_id);
    const payload = row.payload as {
      defaultSkillIds: string[];
      defaultMcpServerIds: string[];
      defaultKnowledgeSourceIds: string[];
    };
    const reconciled = {
      ...payload,
      defaultSkillIds: payload.defaultSkillIds.filter((id) =>
        availableSkillIds.has(`${projectId}:${id}`),
      ),
      defaultMcpServerIds: payload.defaultMcpServerIds.filter((id) =>
        availableMcpServerIds.has(`${projectId}:${id}`),
      ),
      defaultKnowledgeSourceIds: payload.defaultKnowledgeSourceIds.filter(
        (id) => availableKnowledgeSourceIds.has(`${projectId}:${id}`),
      ),
    };
    const encoded = JSON.stringify(reconciled).replaceAll("'", "''");
    memory.public.none(
      `UPDATE tasklattice.agent_specializations
          SET payload = '${encoded}'::jsonb
        WHERE project_id = '${projectId.replaceAll("'", "''")}'
          AND id = '${String(row.id).replaceAll("'", "''")}';`,
    );
  }
  for (const skill of developmentResourceCatalog.skills) {
    const payload = JSON.stringify(skill).replaceAll("'", "''");
    memory.public.none(
      `UPDATE tasklattice.skills
          SET payload = '${payload}'::jsonb
        WHERE project_id = 'individual' AND id = '${skill.id}';`,
    );
  }
  if (
    !modelRoutingDomainMigration.includes("RENAME TO model_routings")
    || !modelRoutingDomainMigration.includes("model_routing_id")
    || !modelRoutingDomainMigration.includes("modelRoutingId")
  ) {
    throw new Error("Model Routing domain migration is incomplete.");
  }
  // pg-mem does not implement PostgreSQL constraint/index renaming or the
  // production JSONB backfill. Test seeds contain no routing or Instance rows,
  // so the equivalent structural table/column rename is sufficient here.
  memory.public.none(`
    ALTER TABLE tasklattice.model_profile_bindings
      DROP CONSTRAINT "model_profile_bindings_model_profile_id|project_id_fk";
    ALTER TABLE tasklattice.model_profiles RENAME TO model_routings;
    ALTER TABLE tasklattice.model_profile_bindings RENAME TO model_routing_bindings;
    ALTER TABLE tasklattice.model_routing_bindings RENAME COLUMN model_profile_id TO model_routing_id;
    ALTER TABLE tasklattice.model_routing_bindings
      ADD CONSTRAINT model_routing_bindings_project_id_model_routing_id_fkey
      FOREIGN KEY (project_id, model_routing_id)
      REFERENCES tasklattice.model_routings(project_id, id)
      ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE tasklattice.model_profile_audit RENAME TO model_routing_audit;
    ALTER TABLE tasklattice.model_routing_audit RENAME COLUMN model_profile_id TO model_routing_id;
  `);
  if (
    !capabilityAdmissionMigration.includes("authorization_environment")
    || !capabilityAdmissionMigration.includes("WHEN type = 'personal' THEN 'DEV'")
    || !capabilityAdmissionMigration.includes("authorization_environment IN ('DEV', 'UAT', 'PROD')")
    || !capabilityAdmissionMigration.includes("authorization_capability")
    || capabilityAdmissionMigration.includes("ALTER TYPE tasklattice.project_role")
    || capabilityAdmissionMigration.includes("backfill")
  ) {
    throw new Error("Project capability admission migration is incomplete.");
  }
  // pg-mem applies the authorization-environment and audit additions using an
  // equivalent sequence because it does not support every multi-action ALTER
  // TABLE form used by PostgreSQL.
  memory.public.none(`
    ALTER TABLE tasklattice.projects
      ADD COLUMN authorization_environment TEXT NOT NULL DEFAULT 'PROD';
    UPDATE tasklattice.projects
      SET authorization_environment = CASE
        WHEN type = 'personal' THEN 'DEV'
        ELSE 'PROD'
      END;
    ALTER TABLE tasklattice.projects
      ADD CONSTRAINT projects_authorization_environment_check
      CHECK (authorization_environment IN ('DEV', 'UAT', 'PROD'));
    ALTER TABLE tasklattice.audit_logs
      ADD COLUMN authorization_capability TEXT,
      ADD COLUMN authorization_reason TEXT;
    ALTER TABLE tasklattice.audit_logs
      DROP CONSTRAINT audit_logs_authorization_decision_check;
    ALTER TABLE tasklattice.audit_logs
      ADD CONSTRAINT audit_logs_authorization_decision_check
      CHECK (authorization_decision IN ('allowed', 'denied', 'approval_required'));
    CREATE INDEX audit_logs_project_capability_idx
      ON tasklattice.audit_logs(project_id, authorization_capability, occurred_at DESC);
  `);
  if (
    !projectRunMetricsMigration.includes("project_runs_runtime_id_key")
    || !projectRunMetricsMigration.includes("project_runs_status_check")
    || !projectRunMetricsMigration.includes("project_runs_terminal_time_check")
  ) {
    throw new Error("Project Run metrics migration is incomplete.");
  }
  memory.public.none(projectRunMetricsMigration);
  // PostgreSQL drops CHECK constraints that depend on a removed column.
  // pg-mem removes the column but retains its generated anonymous constraint,
  // so mirror PostgreSQL's dependency cleanup explicitly for the test schema.
  memory.public.none(
    "ALTER TABLE tasklattice.projects DROP CONSTRAINT projects_constraint_1;",
  );
  memory.public.none(removeProjectTypeMigration);
  if (
    !projectBudgetWindowsMigration.includes("project_quotas_budget_window_check")
    || !projectBudgetWindowsMigration.includes("budget_period_started_at")
  ) {
    throw new Error("Project budget window migration is incomplete.");
  }
  memory.public.none(projectBudgetWindowsMigration);
  if (!modelUsageRunCorrelationMigration.includes("model_usage_fact_run_time_idx")) {
    throw new Error("Model usage Run-correlation migration is incomplete.");
  }
  memory.public.none(modelUsageRunCorrelationMigration);
  if (
    !removeBusinessEnvironmentsMigration.includes("DROP COLUMN IF EXISTS authorization_environment")
    || !removeBusinessEnvironmentsMigration.includes("DROP COLUMN IF EXISTS environment_id")
    || !removeBusinessEnvironmentsMigration.includes("TRUNCATE TABLE tasklattice.model_usage_daily")
    || !removeBusinessEnvironmentsMigration.includes(
      "PRIMARY KEY (project_id, usage_date, timezone, group_type, group_id)",
    )
  ) {
    throw new Error("Business Environment removal migration is incomplete.");
  }
  memory.public.none(removeBusinessEnvironmentsMigration);
  memory.public.none(accountLanguageAndNotificationsMigration);
  memory.public.none(projectRoleSessionsMigration);
  if (
    !directProjectRoleSwitchingMigration.includes("DROP TABLE tasklattice.project_role_activations")
    || !directProjectRoleSwitchingMigration.includes("DROP COLUMN mode")
    || !directProjectRoleSwitchingMigration.includes("DROP TYPE tasklattice.project_role_assignment_mode")
  ) {
    throw new Error("Direct Project role switching migration is incomplete.");
  }
  // pg-mem cannot resolve a correlated UPDATE against an aliased target row.
  // Apply the same data transition row-by-row, then run the structural DDL.
  memory.public.none(`
    INSERT INTO tasklattice.project_member_role_assignments (
      project_id, user_id, role, mode
    )
    SELECT project_id, user_id, role, 'active'::tasklattice.project_role_assignment_mode
    FROM tasklattice.project_members
    ON CONFLICT (project_id, user_id, role) DO NOTHING;
  `);
  for (const row of memory.public.many(`
    SELECT project_id, user_id
    FROM tasklattice.project_member_role_assignments
    WHERE role = 'admin' AND mode = 'eligible'
  `)) {
    const projectId = String(row.project_id).replaceAll("'", "''");
    const userId = String(row.user_id).replaceAll("'", "''");
    memory.public.none(`
      UPDATE tasklattice.project_members
      SET role = 'admin'
      WHERE project_id = '${projectId}' AND user_id = '${userId}';
    `);
  }
  memory.public.none(`
    DROP TABLE tasklattice.project_role_activations;
    DROP INDEX tasklattice.project_member_role_assignments_project_role_mode_idx;
    ALTER TABLE tasklattice.project_member_role_assignments DROP COLUMN mode;
    CREATE INDEX project_member_role_assignments_project_role_idx
      ON tasklattice.project_member_role_assignments(project_id, role);
  `);
  if (
    !projectDeletionTasksMigration.includes("project_deletion_tasks_due_idx")
    || !projectDeletionTasksMigration.includes("status IN ('scheduled', 'running', 'retry')")
  ) {
    throw new Error("Project deletion task migration structure is incomplete.");
  }
  memory.public.none(projectDeletionTasksMigration);
  memory.public.none(
    departmentsMigration
      .replaceAll("DECIMAL(18, 6)", "NUMERIC")
      // pg-mem does not apply ON UPDATE CASCADE across the full fixture graph.
      // Keep the historical test fixture id; PostgreSQL migrates it to proj1.
      .replace(
        /-- This repository is pre-release[\s\S]*?-- End local fixture rename\.\s*/,
        "",
      ),
  );
  memory.public.none(departmentRolesMigration);
  if (
    !projectRuntimeTargetsMigration.includes("project_runtime_targets_due_idx")
    || !projectRuntimeTargetsMigration.includes(
      "Existing Projects are backfilled by the runtime-target worker",
    )
    || !projectRuntimeTargetsMigration.includes("observed_generation")
  ) {
    throw new Error("Project Runtime Target migration structure is incomplete.");
  }
  memory.public.none(projectRuntimeTargetsMigration);
  if (
    !managedA2aInstancesMigration.includes("managed_a2a_instances_agent_idx")
    || !managedA2aInstancesMigration.includes(
      "managed_a2a_instances_owner_membership_fkey",
    )
  ) {
    throw new Error("Managed A2A Instance migration structure is incomplete.");
  }
  memory.public.none(managedA2aInstancesMigration);
  memory.public.none(
    platformSettingsMigration
      .replace(
        /ALTER TYPE "tasklattice"\."system_role"[\s\S]*?;/,
        "",
      )
      .replaceAll("DECIMAL(18, 6)", "NUMERIC"),
  );
  memory.public.none(platformAuthSettingsMigration);
  memory.public.none(platformEmailAndRuntimePolicyMigration);
  memory.public.none(platformSandboxDefaultsMigration);
  memory.public.none(
    ssoRoleBindingsMigration
      .replaceAll("ROLE_APPROVER", "ROLE_REVIEWER")
      .replace(
        /,\n  CONSTRAINT "external_role_bindings_subject_path_check" CHECK \([\s\S]*?\n  \),\n  CONSTRAINT "external_role_bindings_scope_check"/,
        ',\n  CONSTRAINT "external_role_bindings_scope_check"',
      )
      .replace(
        /CREATE UNIQUE INDEX "external_role_bindings_unique_mapping_idx"[\s\S]*?;\s*/,
        "",
      ),
  );
  memory.public.none(
    builtinRoleCatalogMigration
      .replace(
        /ALTER TYPE "tasklattice"\."project_role"[\s\S]*?;\s*/,
        "",
      )
      .replace(
        /,\n  CONSTRAINT "role_capability_grants_relations_array_check"[\s\S]*?CHECK \(jsonb_typeof\("relations"\) = 'array'\)\n/,
        "\n",
      ),
  );
  memory.public.none(
    departmentSettingsMigration.replaceAll("DECIMAL(18, 6)", "NUMERIC"),
  );
  memory.public.none(
    compactSsoGroupPathsMigration
      .replace(
        /ALTER TABLE "tasklattice"\."external_role_bindings"\s+DROP CONSTRAINT "external_role_bindings_subject_path_check";/,
        "",
      )
      .replace(
        /ALTER TABLE "tasklattice"\."external_role_bindings"\s+ADD CONSTRAINT "external_role_bindings_subject_path_check" CHECK \([\s\S]*?\n  \);/,
        "",
      ),
  );
  memory.public.none(platformRuntimeSettingsMigration);
  memory.public.none(businessRecordSoftDeleteMigration);
  memory.public.none(
    unifiedAgentInstancesMigration
      // pg-mem does not implement PostgreSQL's JSONB mutation helpers. The
      // fixture has no legacy A2A rows or Platform settings at this point.
      .replace(
        "jsonb_set(payload, '{kind}', '\"A2A\"'::jsonb, true)",
        "payload",
      )
      .replace(
        /UPDATE tasklattice\.platform_settings\s+SET runtime_images = jsonb_build_object\([\s\S]*?\);/,
        "",
      ),
  );
  memory.public.none(departmentInferenceResourcesMigration);
  if (
    !controlWorkerQueueMigration.includes("queue_job_id UUID")
    || !controlWorkerQueueMigration.includes("'failed'")
  ) {
    throw new Error("Control Worker queue migration structure is incomplete.");
  }
  memory.public.none(controlWorkerQueueMigration);
  memory.public.none(accessContextSessionsMigration);
  if (
    !knowledgeVectorDatabaseMigration.includes("CREATE EXTENSION IF NOT EXISTS vector")
    || !knowledgeVectorDatabaseMigration.includes("embedding public.vector NOT NULL")
    || !knowledgeVectorDatabaseMigration.includes("public.vector_dims(embedding)")
  ) {
    throw new Error("Knowledge Vector Database migration is incomplete.");
  }
  // pg-mem does not implement extensions or custom vector types. Preserve the
  // relational shape for service tests and cover vector SQL separately with a
  // mocked Prisma raw-query boundary.
  memory.public.none(
    knowledgeVectorDatabaseMigration
      .replace(/CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;\s*/, "")
      .replace("embedding public.vector NOT NULL", "embedding TEXT NOT NULL")
      .replace(
        /  CONSTRAINT knowledge_vector_chunks_embedding_dimensions_check\s+CHECK \(public\.vector_dims\(embedding\) = embedding_dimensions\),\s*/,
        "",
      )
      .replace(
        /CREATE INDEX knowledge_vector_chunks_attributes_idx\s+ON tasklattice\.knowledge_vector_chunks USING gin\(attributes\);\s*/,
        "",
      ),
  );
  memory.public.none(departmentResourceAssignmentsMigration);
  memory.public.none(vectorDatabaseDocumentsMigration);
  memory.public.none(vectorDocumentDirectoriesMigration);
  memory.public.none(
    vectorDatabaseFoldersMigration
      // Test databases start without Vector Documents. pg-mem does not support
      // the recursive backfill or PostgreSQL JSONB concatenation used in production.
      .replace(/-- Preserve the logical directories[\s\S]*?ON CONFLICT DO NOTHING;\s*/, "")
      .replace(/UPDATE tasklattice\.vector_documents AS document[\s\S]*?WHERE document\.directory_path <> '\/';\s*/, "")
      .replace(/UPDATE tasklattice\.knowledge_vector_chunks AS chunk[\s\S]*?AND document\.id = chunk\.document_id;\s*/, "")
      .replaceAll(" DEFAULT gen_random_uuid()", ""),
  );
  memory.public.none(vectorDocumentMetadataMigration);
  memory.public.none(
    projectDurableMemoryMigration.replaceAll(" DEFAULT gen_random_uuid()", ""),
  );
  memory.public.none(memoryAgentIdempotencyMigration);
  const instanceLifecycleSchema = instanceLifecycleOperationsMigration
    .split("INSERT INTO tasklattice.instance_lifecycle_operations")[0];
  if (
    !instanceLifecycleSchema?.includes("instance_lifecycle_operations")
    || !instanceLifecycleSchema.includes("instance_lifecycle_events")
  ) {
    throw new Error("Instance lifecycle operation migration structure is incomplete.");
  }
  memory.public.none(instanceLifecycleSchema);
  const expertAgentDeliverySchema = expertAgentDeliveryLifecycleMigration
    // pg-mem does not implement PL/pgSQL trigger functions. Service tests still
    // apply every table, FK, CHECK, and index; PostgreSQL trigger behavior is
    // covered by the production migration itself.
    .split("CREATE FUNCTION tasklattice.validate_expert_agent_reference()")[0]!
    .replaceAll(" DEFAULT gen_random_uuid()", "")
    // pg-mem does not implement PostgreSQL's text regex operator. Zod and the
    // production database both retain these format checks.
    .replace(
      /,\n  (?:ADD )?CONSTRAINT [^\n]+\n    CHECK \([^\n]+ ~ '[^']+'\)/g,
      "",
    );
  if (
    !expertAgentDeliverySchema.includes("expert_agent_candidates")
    || !expertAgentDeliverySchema.includes("expert_agent_versions")
    || !expertAgentDeliveryLifecycleMigration.includes(
      "reject_expert_agent_immutable_update",
    )
  ) {
    throw new Error("Expert Agent delivery lifecycle migration is incomplete.");
  }
  memory.public.none(expertAgentDeliverySchema);
  memory.public.none(expertAgentContractPolicyMigration);
  memory.public.none(expertAgentDelegationTopologyMigration);
  memory.public.none(expertAgentEvaluationTracesMigration);
  memory.public.none(
    expertAgentWorkingCopyEvaluationsMigration.replaceAll(
      " DEFAULT gen_random_uuid()",
      "",
    ),
  );
  memory.public.none(runtimeInventoryOwnershipMigration);
  const agentVersionArtifactsSchema = agentVersionArtifactsMigration
    // The test database starts without Agent delivery records. Remove the
    // production data reset and apply only the replacement schema.
    .replace(/UPDATE tasklattice\.project_runs[\s\S]*?WHERE expert_agent_id IS NOT NULL;\s*/, "")
    .replace(/DELETE FROM tasklattice\.agents WHERE kind = 'PROJECT_AGENT';\s*/, "")
    .replace(/DROP FUNCTION IF EXISTS tasklattice\.[^;]+;\s*/g, "")
    .replace(
      /TRUNCATE TABLE tasklattice\.expert_agents CASCADE;/,
      "DELETE FROM tasklattice.expert_agents;",
    )
    // pg-mem does not implement PL/pgSQL trigger functions. Service tests
    // retain all tables, FKs, indexes, and non-regex CHECK constraints.
    .split("CREATE FUNCTION tasklattice.validate_agent_release_reference()")[0]!
    .replaceAll(" DEFAULT gen_random_uuid()", "")
    // pg-mem keeps dropped primary-key relation names in its schema catalog.
    // Test-only names avoid colliding with the replaced Version table.
    .replaceAll("expert_agent_versions_", "agent_versions_v2_")
    .replace(
      /,\n  (?:ADD )?CONSTRAINT [^\n]+\n    CHECK \([^\n]+ ~ '[^']+'\)/g,
      "",
    );
  if (
    !agentVersionArtifactsSchema.includes("expert_agent_test_runs")
    || !agentVersionArtifactsSchema.includes("expert_agent_version_artifacts")
    || !agentVersionArtifactsMigration.includes("reject_agent_version_update")
  ) {
    throw new Error("Agent Version and Artifact migration is incomplete.");
  }
  memory.public.none(agentVersionArtifactsSchema);
  const pg = memory.adapters.createPg();
  const query = pg.Client.prototype.query;
  pg.Client.prototype.query = function (
    this: PgClient,
    input: string | { rowMode?: string; types?: unknown },
    ...args: unknown[]
  ) {
    if (typeof input === "object") {
      const arrayRows = input.rowMode === "array";
      const { rowMode: _rowMode, types: _types, ...compatible } = input;
      // Prisma's pg adapter serializes Uint8Array parameters into the Node
      // Buffer JSON shape before they reach pg-mem. Real PostgreSQL's driver
      // accepts the binary value directly, so restore that representation in
      // the in-memory adapter used by service tests.
      const values = (compatible as { values?: unknown[] }).values;
      if (values) {
        (compatible as { values: unknown[] }).values = values.map((value) => {
          if (typeof value !== "string" || !value.startsWith('{"type":"Buffer","data":[')) {
            return value;
          }
          try {
            const parsed = JSON.parse(value) as { type?: string; data?: number[] };
            return parsed.type === "Buffer" && Array.isArray(parsed.data)
              ? Buffer.from(parsed.data)
              : value;
          } catch {
            return value;
          }
        });
      }
      const transform = (result: { fields?: Array<{ name: string }>; rows?: Array<Record<string, unknown>> }) => {
        if (arrayRows && result.rows) {
          const fieldNames = result.fields?.map((field) => field.name) ?? [];
          const names = fieldNames.length && fieldNames.every(Boolean)
            ? fieldNames
            : Object.keys(result.rows[0] ?? {});
          const sample = result.rows[0] ?? {};
          const oid = (value: unknown) =>
            Buffer.isBuffer(value) ? 17
              : value instanceof Date ? 1184
              : typeof value === "boolean" ? 16
                : typeof value === "number" ? 701
                  : typeof value === "bigint" ? 20
                    : typeof value === "object" && value !== null ? 3802
                      : 25;
          const postgresTextArrayFields = new Set([
            "hindsight_memory_ids",
            "source_document_ids",
          ]);
          const fields = names.map((name, index) => ({
            ...(result.fields?.[index] ?? {}),
            name,
            dataTypeID: postgresTextArrayFields.has(name)
              ? 1009
              : (result.fields?.[index] as { dataTypeID?: number } | undefined)?.dataTypeID
                ?? oid(sample[name]),
          }));
          return {
            ...result,
            fields,
            rows: result.rows.map((row) => names.map((name, index) =>
              fields[index]?.dataTypeID === 3802 && typeof row[name] === "object"
                ? JSON.stringify(row[name])
                : row[name],
            )),
          };
        }
        return result;
      };
      const callbackIndex = args.findLastIndex((argument) => typeof argument === "function");
      if (callbackIndex >= 0) {
        const callback = args[callbackIndex] as (error: unknown, result: unknown) => void;
        args[callbackIndex] = (error: unknown, result: Parameters<typeof transform>[0]) =>
          callback(error, error ? result : transform(result));
      }
      const result = query.call(this, compatible, ...args);
      return result && typeof (result as Promise<unknown>).then === "function"
        ? (result as Promise<Parameters<typeof transform>[0]>).then(transform)
        : result;
    }
    return query.call(this, input, ...args);
  } as typeof query;
  const pool = new Pool({ Client: pg.Client } as never);
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}
