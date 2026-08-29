import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { getControlConfig } from "../config/control-config";
import { loadPlatformRuntimeConfiguration } from "../platform/platform-runtime-config";
import {
  verifyProjectRuntimeBridgeToken,
  verifyProjectRuntimeCoordinatorToken,
  type ProjectRuntimeBridgeIdentity,
  type ProjectRuntimeCoordinatorIdentity,
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
