import { reportWorkerRuntime } from "./worker-runtime-report";
import { getWorkerConfig } from "../config/worker-config";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { prisma } from "../db/prisma";
import { PgBossControlJobQueue } from "../jobs/control-job-queue";
import {
  createStructuredLogger,
  serializeError,
} from "../observability/structured-logger";
import {
  startControlWorkerHealthServer,
  stopControlWorkerHealthServer,
  type ControlWorkerHealthState,
} from "./control-worker-health";
import { ControlWorkerTasks } from "./control-worker-tasks";

const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
const logger = createStructuredLogger("control-worker", { workerId });
const healthState: ControlWorkerHealthState = {
  queueReady: false,
  startedAt: new Date().toISOString(),
  stopping: false,
  workerId,
};

const database = prisma();
const jobs = new PgBossControlJobQueue(undefined, getWorkerConfig().role);
const healthServer = await startControlWorkerHealthServer(healthState);
let shutdownRequested!: () => void;
const shutdown = new Promise<void>((resolve) => {
  shutdownRequested = resolve;
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (healthState.stopping) return;
    healthState.stopping = true;
    healthState.queueReady = false;
    logger.log("info", "worker.stopping", { signal });
    shutdownRequested();
  });
}

jobs.boss.on("error", (error) => {
  logger.log("error", "queue.error", serializeError(error));
});
jobs.boss.on("warning", (warning) => {
  logger.log("warn", "queue.warning", { warning });
});

let reportTimer: ReturnType<typeof setInterval> | undefined;
try {
  await jobs.start();
  const tasks = new ControlWorkerTasks({ db: database, jobs, logger });
  const registrations = await tasks.register();
  await jobs.scheduleMaintenance();
  healthState.queueReady = true;
  await reportWorkerRuntime(healthState);
  reportTimer = setInterval(() => {
    void reportWorkerRuntime(healthState).catch((error) => logger.log("error", "worker.report-failed", serializeError(error)));
  }, 30000);
  reportTimer.unref();
  await jobs.enqueueMaintenance("startup");
  healthState.queueReady = true;
  logger.log("info", "worker.started", {
    healthPort: getWorkerConfig().healthPort,
    registrations,
  });
  await shutdown;
} catch (error) {
  process.exitCode = 1;
  logger.log("error", "worker.failed", serializeError(error));
} finally {
  if (reportTimer) clearInterval(reportTimer);
  healthState.stopping = true;
  healthState.queueReady = false;
  await jobs.stop(9 * 60 * 1_000).catch((error) => {
    logger.log("error", "queue.stop-failed", serializeError(error));
  });
  await stopControlWorkerHealthServer(healthServer).catch((error) => {
    logger.log("error", "health.stop-failed", serializeError(error));
  });
  await database.$disconnect();
  logger.log("info", "worker.stopped");
}
