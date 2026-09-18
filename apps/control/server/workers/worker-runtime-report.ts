import { getWorkerConfig } from "../config/worker-config";
import { prisma } from "../db/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import { verifyRuntimeNamespaceAccess } from "./worker-kubernetes-access";
import type { ControlWorkerHealthState } from "./control-worker-health";

export async function reportWorkerRuntime(
  state: ControlWorkerHealthState,
  db: PrismaClient = prisma(),
): Promise<void> {
  const config = getWorkerConfig();
  const gateway = config.project_openshell;
  let kubernetesAccess = false;
  try {
    await verifyRuntimeNamespaceAccess();
    kubernetesAccess = true;
  } catch {
    /* report unavailable capability */
  }
  const workerRuntime = {
    reportedAt: new Date().toISOString(),
    workerId: state.workerId,
    ready: state.queueReady && !state.stopping,
    kubernetesAccess,
    projectTargetRouting: gateway.targetRouting,
    ...(gateway.enabled
      ? {
          sandbox: {
            gatewayImage: `${gateway.gatewayImageRepository}:${gateway.gatewayImageTag}`,
            supervisorImage: `${gateway.supervisorImageRepository}:${gateway.supervisorImageTag}`,
            defaultImage: gateway.sandboxImage,
            defaultImagePullPolicy: gateway.sandboxImagePullPolicy,
            tlsDisabled: true,
          },
        }
      : {}),
  };
  await db.platformSettingsRecord.upsert({
    where: { id: "platform" },
    create: { id: "platform", revision: 0, workerRuntime },
    update: { workerRuntime },
  });
}
