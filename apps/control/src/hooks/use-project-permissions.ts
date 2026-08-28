import { useProject } from "@/hooks/use-project";
import type { ProjectPermissions } from "@/types/project";
import type { ProjectCapability } from "@tali/contracts";

export function permissionsForCapabilities(
  capabilities: readonly ProjectCapability[],
  options: { canCreateProject?: boolean } = {},
): ProjectPermissions {
  const granted = new Set(capabilities);
  return {
    canCreateAgents: granted.has("CAP_AGENT_INSTANCE_CREATE"),
    canDeleteAgents: granted.has("CAP_AGENT_INSTANCE_DELETE"),
    canInteractWithAgents: granted.has("CAP_AGENT_INSTANCE_INTERACT"),
    canViewAgentLogs: granted.has("CAP_AGENT_INSTANCE_LOG_VIEW"),
    canUseAgentTerminal: granted.has("CAP_AGENT_INSTANCE_TERMINAL_EXEC"),
    canViewSensitiveAgentAudit:
      granted.has("CAP_AUDIT_DETAIL_VIEW") &&
      granted.has("CAP_AUDIT_SENSITIVE_CONTENT_VIEW"),
    canCreateProject: options.canCreateProject ?? false,
    canDeleteProject: granted.has("CAP_PROJECT_DELETE"),
    canInviteMembers: granted.has("CAP_PROJECT_MEMBER_INVITE"),
    canRemoveMembers: granted.has("CAP_PROJECT_MEMBER_REMOVE"),
    canAssignRoles: granted.has("CAP_PROJECT_MEMBER_ROLE_ASSIGN"),
    canManageResources: [
      "CAP_SKILL_CREATE",
      "CAP_MCP_SERVER_CREATE",
      "CAP_VECTOR_DATABASE_CREATE",
      "CAP_PROVIDER_CREATE",
    ].some((capability) => granted.has(capability as ProjectCapability)),
    canViewVectorDatabases: granted.has("CAP_VECTOR_DATABASE_VIEW"),
    canViewVectorDatabaseContent: granted.has("CAP_VECTOR_DATABASE_CONTENT_VIEW"),
    canCreateVectorDatabases: granted.has("CAP_VECTOR_DATABASE_CREATE"),
    canUpdateVectorDatabases: granted.has("CAP_VECTOR_DATABASE_UPDATE"),
    canDeleteVectorDatabases: granted.has("CAP_VECTOR_DATABASE_DELETE"),
    canManageProject: granted.has("CAP_PROJECT_SETTINGS_UPDATE"),
    canViewMemories: granted.has("CAP_AGENT_MEMORY_ITEM_VIEW"),
    canViewMemoryContent: granted.has("CAP_AGENT_MEMORY_CONTENT_VIEW"),
    canManageMemories: granted.has("CAP_AGENT_MEMORY_CONFIG_UPDATE"),
    canViewMemorySettings: granted.has("CAP_AGENT_MEMORY_CONFIG_VIEW"),
    canCurateMemory: granted.has("CAP_AGENT_MEMORY_CONTENT_WRITE"),
    canDeleteMemoryContent: granted.has("CAP_AGENT_MEMORY_CONTENT_DELETE"),
    canPurgeMemories: granted.has("CAP_AGENT_MEMORY_CONTENT_PURGE"),
    canExportMemories: granted.has("CAP_AGENT_MEMORY_EXPORT"),
    canReextractMemory: granted.has("CAP_AGENT_MEMORY_SESSION_INDEX_MANAGE"),
    canViewMemoryOutbox: granted.has("CAP_AGENT_MEMORY_INDEX_STATUS_VIEW"),
    canReplayMemoryOutbox: granted.has("CAP_AGENT_MEMORY_INDEX_REBUILD"),
    canViewAuditLogs:
      granted.has("CAP_AUDIT_VIEW") || granted.has("CAP_AUDIT_DETAIL_VIEW"),
    canViewResources: [
      "CAP_SKILL_VIEW",
      "CAP_MCP_SERVER_VIEW",
      "CAP_VECTOR_DATABASE_VIEW",
    ].some((capability) => granted.has(capability as ProjectCapability)),
  };
}

export function useProjectPermissions(): ProjectPermissions {
  const { availableProjects, currentProject } = useProject();

  return permissionsForCapabilities(
    currentProject?.effectiveCapabilities ?? [],
    {
      canCreateProject: availableProjects.some(
        (project) => project.department.role === "administrator",
      ),
    },
  );
}
