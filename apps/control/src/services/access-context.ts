import type {
  BuiltinProjectRoleId,
  BuiltinRoleId,
  ProjectMembershipRole,
} from "@tali/contracts";
import { AccessContextRequestError } from "@/lib/access-context-error";

export type AccessContextLevel = "platform" | "department" | "project";

export interface AccessContextOption {
  description: string;
  id: string;
  level: AccessContextLevel;
  resourceId: string | null;
  resourceName: string;
  roleId: BuiltinRoleId;
  roleLabel: string;
  target: string;
}

export interface AccessContextState {
  active: AccessContextOption | null;
  options: AccessContextOption[];
}

export type SelectAccessContextInput = Pick<
  AccessContextOption,
  "level" | "resourceId" | "roleId"
>;

export const projectRoleToBuiltinRole = {
  admin: "ROLE_PROJECT_ADMIN",
  auditor: "ROLE_AUDITOR",
  developer: "ROLE_AGENT_DEVELOPER",
  reviewer: "ROLE_REVIEWER",
  user: "ROLE_USER",
} as const satisfies Record<ProjectMembershipRole, BuiltinProjectRoleId>;

async function accessContextRequest(
  init?: RequestInit,
): Promise<AccessContextState> {
  const response = await fetch("/api/v1/access-context", {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = payload && typeof payload === "object"
      ? payload as Record<string, unknown> : undefined;
    throw new AccessContextRequestError(
      response.status,
      typeof problem?.code === "string" ? problem.code : undefined,
      typeof problem?.detail === "string" ? problem.detail
        : typeof problem?.message === "string" ? problem.message : undefined,
    );
  }
  if (!payload || typeof payload !== "object") {
    throw new AccessContextRequestError(response.status);
  }
  return payload as AccessContextState;
}

export function getAccessContext(): Promise<AccessContextState> {
  return accessContextRequest();
}

export function selectAccessContext(
  input: SelectAccessContextInput,
): Promise<AccessContextState> {
  return accessContextRequest({
    method: "PUT",
    body: JSON.stringify(input),
  });
}
