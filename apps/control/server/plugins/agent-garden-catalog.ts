import { definePlugin } from "nitro";
import { createStructuredLogger, serializeError } from "../observability/structured-logger";
import { seedAgentCatalogForExistingProjects } from "../agent-garden/seed-agent-catalog";
import { prisma } from "../db/prisma";

const logger = createStructuredLogger("control");

export default definePlugin(() => {
  void seedAgentCatalogForExistingProjects(prisma())
    .then(({ projects, records }) => {
      logger.log("info", "catalog.seed_completed", { projects, records });
    })
    .catch((error) => {
      logger.log("error", "catalog.seed_failed", serializeError(error));
    });
});
