import { definePlugin } from "nitro";
import { createStructuredLogger, serializeError } from "../observability/structured-logger";
import { prisma } from "../db/prisma";
import { CostIngestionService } from "../providers/cost-ingestion-service";

const pollingIntervalMs = 60 * 1_000;

const logger = createStructuredLogger("control");

export default definePlugin(() => {
  const ingestion = new CostIngestionService(prisma());
  const sync = () => {
    void ingestion.syncAll().then((result) => {
      if (result.failedProjects.length) {
        logger.log("error", "cost.ingestion_partial_failure", { failedProjects: result.failedProjects });
      }
    }).catch((error) => {
      logger.log("error", "cost.ingestion_failed", serializeError(error));
    });
  };

  sync();
  const timer = setInterval(sync, pollingIntervalMs);
  timer.unref();
});
