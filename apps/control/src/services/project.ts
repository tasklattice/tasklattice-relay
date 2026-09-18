import type {
  ProjectQuota,
  UpdateProjectQuotaInput,
} from "@tali/contracts";
import type {
  HumanProjectMember,
  Project,
  ProjectDeletionImpact,
  ProjectDeletionSchedule,
  ProjectRole,
} from "@/types/project";

export type ProjectAccess = Pick<
  Project,
  | "assignedRoles"
  | "activeRole"
  | "effectiveCapabilities"
>;

async function projectRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as T | { detail?: string } : undefined;
  if (!response.ok) {
    const problem = payload as { detail?: string } | undefined;
    throw new Error(problem?.detail ?? `Request failed (${response.status}).`);
  }
  return payload as T;
}

export async function getProjects(): Promise<Project[]> {
  return projectRequest<Project[]>("/api/v1/projects");
}

export async function getProjectMembers(projectId: string): Promise<HumanProjectMember[]> {
  return projectRequest<HumanProjectMember[]>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/members`,
  );
}

export async function createProject(input: {
  departmentId: string;
  invitations: Array<{ email: string; role: ProjectRole }>;
  name: string;
}): Promise<Project> {
  return projectRequest<Project>("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function renameProject(projectId: string, name: string): Promise<Project> {
  return projectRequest<Project>(
    `/api/v1/projects/${encodeURIComponent(projectId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
}

export async function getProjectDeletionImpact(
  projectId: string,
): Promise<ProjectDeletionImpact> {
  return projectRequest<ProjectDeletionImpact>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/deletion-impact`,
  );
}

export async function deleteProject(
  projectId: string,
): Promise<ProjectDeletionSchedule> {
  return projectRequest<ProjectDeletionSchedule>(
    `/api/v1/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  );
}

export async function inviteMember(
  projectId: string,
  input: { email: string; role: ProjectRole },
): Promise<HumanProjectMember> {
  return projectRequest<HumanProjectMember>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/members/invitations`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function removeMember(projectId: string, memberId: string): Promise<void> {
  await projectRequest(
    `/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(memberId)}`,
    { method: "DELETE" },
  );
}

export async function switchProjectRole(
  projectId: string,
  role: ProjectRole,
): Promise<ProjectAccess> {
  return projectRequest<ProjectAccess>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/role`,
    { method: "PUT", body: JSON.stringify({ role }) },
  );
}

export async function getProjectQuota(projectId: string): Promise<ProjectQuota> {
  return projectRequest<ProjectQuota>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/quota`,
  );
}

export async function updateProjectQuota(
  projectId: string,
  input: UpdateProjectQuotaInput,
): Promise<ProjectQuota> {
  return projectRequest<ProjectQuota>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/quota`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export interface ProjectRuntimeStatus {
  status: string;
  generation: number;
  observedGeneration: number;
  attempts: number;
  lastError: string | null;
  updatedAt: string | null;
}
export function getProjectRuntime(projectId: string): Promise<ProjectRuntimeStatus> {
  return projectRequest(`/api/v1/projects/${encodeURIComponent(projectId)}/initialization`);
}
export function retryProjectRuntime(projectId: string): Promise<ProjectRuntimeStatus> {
  return projectRequest(`/api/v1/projects/${encodeURIComponent(projectId)}/initialization/retry`, { method: "POST" });
}
