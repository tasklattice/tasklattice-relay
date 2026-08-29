import { defineHandler } from "nitro";
import { prisma } from "../../db/prisma";
import { createMemoryProvider } from "../../memories/memory-provider-factory";
import {
  memoryMetrics,
  metricsRequestAuthorized,
  renderMemoryMetrics,
} from "../../memories/memory-metrics";

export default defineHandler(async (event) => {
  if (!metricsRequestAuthorized(event.req)) {
    return new Response("Unauthorized.\n", {
      status: 401,
      headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
    });
  }
  try {
    const health = await createMemoryProvider().healthCheck({});
    memoryMetrics.recordProviderHealth(health.status);
  } catch {
    memoryMetrics.recordProviderHealth("unavailable");
  }
  return new Response(await renderMemoryMetrics(prisma()), {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    },
  });
});
