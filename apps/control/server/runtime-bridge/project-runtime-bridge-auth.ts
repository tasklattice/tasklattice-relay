import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { getControlConfig } from "../config/control-config";
import { loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";
import {
  verifyProjectRuntimeBridgeToken,
  verifyProjectRuntimeCoordinatorToken,
  verifyProjectRuntimeExpertAgentToken,
  type ProjectRuntimeBridgeIdentity,
  type ProjectRuntimeCoordinatorIdentity,
  type ProjectRuntimeExpertAgentIdentity,
} from "./project-runtime-bridge-token";

export async function requireProjectRuntimeBridge(
  request: Request,
  db: PrismaClient = prisma(),
): Promise<ProjectRuntimeBridgeIdentity> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new Error("Project Runtime Bridge authentication is required.");
  }
  const runtime = await loadPlatformRuntimeConfiguration(db);
  const identity = verifyProjectRuntimeBridgeToken(
    authorization.slice("Bearer ".length),
    runtime.runner.token,
  );
  const target = await db.projectRuntimeTarget.findUnique({
    where: { projectId: identity.projectId },
    select: { namespace: true, status: true },
  });
  if (
    !target
    || target.namespace !== identity.namespace
    || target.status === "deleting"
  ) {
    throw new Error("Project Runtime Bridge access denied.");
  }
  return identity;
}

export async function requireProjectRuntimeCoordinator(
  request: Request,
  bridge: ProjectRuntimeBridgeIdentity,
  coordinatorInstanceId: string,
  db: PrismaClient = prisma(),
): Promise<ProjectRuntimeCoordinatorIdentity> {
  const token = request.headers.get("x-tali-coordinator-token") ?? "";
  const coordinator = verifyProjectRuntimeCoordinatorToken(
    token,
    getControlConfig().auth.secret,
  );
  if (
    coordinator.projectId !== bridge.projectId
    || coordinator.namespace !== bridge.namespace
    || coordinator.coordinatorInstanceId !== coordinatorInstanceId
  ) {
    throw new Error("Project Runtime Coordinator access denied.");
  }
  return coordinator;
}

export async function requireProjectRuntimeExpertAgent(
  request: Request,
  bridge: ProjectRuntimeBridgeIdentity,
  route: { agentId: string; versionId: string },
  db: PrismaClient = prisma(),
): Promise<ProjectRuntimeExpertAgentIdentity> {
  const token = request.headers.get("x-tali-expert-agent-token") ?? "";
  const identity = verifyProjectRuntimeExpertAgentToken(
    token,
    getControlConfig().auth.secret,
  );
  const headerIdentity = {
    agentId: request.headers.get("x-tali-expert-agent-id") ?? "",
    versionId: request.headers.get("x-tali-expert-agent-version-id") ?? "",
    contentDigest: request.headers.get("x-tali-expert-agent-content-digest") ?? "",
  };
  if (
    identity.projectId !== bridge.projectId
    || identity.namespace !== bridge.namespace
    || identity.agentId !== route.agentId
    || identity.versionId !== route.versionId
    || headerIdentity.agentId !== identity.agentId
    || headerIdentity.versionId !== identity.versionId
    || headerIdentity.contentDigest !== identity.contentDigest
  ) {
    throw new Error("Expert Agent Runtime access denied.");
  }

  const version = await db.expertAgentVersionRecord.findFirst({
    where: {
      projectId: bridge.projectId,
      id: identity.versionId,
      agentId: identity.agentId,
      contentDigest: identity.contentDigest,
      agent: { deletedAt: null },
    },
    select: { contentDigest: true },
  });
  if (!version || version.contentDigest !== identity.contentDigest) {
    throw new Error("Expert Agent Runtime access denied.");
  }

  const instance = await db.agentRecord.findFirst({
    where: {
      projectId: bridge.projectId,
      kind: "PROJECT_AGENT",
      developedAgentId: identity.agentId,
      agentVersionId: identity.versionId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!instance) {
    throw new Error("Expert Agent Runtime Version has no materialized Instance.");
  }
  return identity;
}
