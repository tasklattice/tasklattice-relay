import type { ProjectCapability, ProjectMembershipRole } from "@tali/contracts";

export type ProjectRole = ProjectMembershipRole;

export const projectRoleLabels: Record<ProjectRole, string> = {
  admin: "Project Administrator",
  auditor: "Auditor",
  developer: "Agent Developer",
  user: "User",
  reviewer: "Reviewer",
};

export interface Project {
  department: {
    id: string;
    name: string;
    role: "administrator" | "member" | null;
  };
  id: string;
  name: string;
  avatar?: string;
  memberCount: number;
  assignedRoles: readonly ProjectRole[];
  activeRole: ProjectRole;
  effectiveCapabilities: readonly ProjectCapability[];
}

export interface ProjectDeletionActiveResource {
  id: string;
  kind:
    | "instance"
    | "provider"
    | "model"
    | "gateway"
    | "routing"
    | "mcp-server"
    | "vector-database";
  kindLabel: string;
  name: string;
  status: string;
}

export interface ProjectDeletionImpact {
  activeResources: ProjectDeletionActiveResource[];
  auditLogsRetained: true;
  delayMinutes: number;
  projectId: string;
  projectName: string;
  resourceCounts: Array<{
    count: number;
    kind: string;
    label: string;
  }>;
  totalResourceCount: number;
}

export interface ProjectDeletionSchedule {
  delayMinutes: number;
  projectId: string;
  requestedAt: string;
  scheduledFor: string;
  status: "scheduled";
}

export interface HumanProjectMember {
  id: string;
  kind: "human";
  name: string;
  email: string;
  roles: readonly ProjectRole[];
  activeRole?: ProjectRole;
  status: "active" | "invited";
}

export interface ProjectPermissions {
  canCreateAgents: boolean;
  canDeleteAgents: boolean;
  canInteractWithAgents: boolean;
  canViewAgentLogs: boolean;
  canUseAgentTerminal: boolean;
  canViewSensitiveAgentAudit: boolean;
  canCreateProject: boolean;
  canDeleteProject: boolean;
  canInviteMembers: boolean;
  canRemoveMembers: boolean;
  canAssignRoles: boolean;
  canManageResources: boolean;
  canViewVectorDatabases: boolean;
  canViewVectorDatabaseContent: boolean;
  canCreateVectorDatabases: boolean;
  canUpdateVectorDatabases: boolean;
  canDeleteVectorDatabases: boolean;
  canManageProject: boolean;
  canViewMemories: boolean;
  canViewMemoryContent: boolean;
  canManageMemories: boolean;
  canViewMemorySettings: boolean;
  canCurateMemory: boolean;
  canDeleteMemoryContent: boolean;
  canPurgeMemories: boolean;
  canExportMemories: boolean;
  canReextractMemory: boolean;
  canViewMemoryOutbox: boolean;
  canReplayMemoryOutbox: boolean;
  canViewAuditLogs: boolean;
  canViewResources: boolean;
}
