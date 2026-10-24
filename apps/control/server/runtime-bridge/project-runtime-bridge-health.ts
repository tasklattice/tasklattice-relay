import type { Express } from "express";

export const CONTROL_HEALTH_TIMEOUT_MS = 2_000;

export function registerRuntimeBridgeHealth(
  app: Express,
  configuration: { controlUrl: string; projectId: string },
): void {
  // An upstream outage must remove the Bridge from Service endpoints, without
  // restarting an otherwise healthy process and losing its diagnostic logs.
  const identity = {
    projectId: configuration.projectId,
    capabilityKinds: [
      "A2A_AGENT", "VECTOR_DATABASE", "DURABLE_MEMORY", "EXPERT_AGENT_RESOURCE",
    ],
  };
  // Existing Deployments use /healthz for liveness. Preserve that contract
  // during image-first upgrades; readiness is enabled by Worker reconciliation.
  app.get(["/healthz", "/livez"], (_request, response) => response.json({ ok: true, ...identity }));

  app.get("/readyz", async (_request, response) => {
    response.set("Cache-Control", "no-store");
    const signal = AbortSignal.timeout(CONTROL_HEALTH_TIMEOUT_MS);
    try {
      const upstream = await fetch(
        `${configuration.controlUrl.replace(/\/$/, "")}/api/health`,
        { signal, redirect: "manual" },
      );
      if (!upstream.ok) {
        await upstream.body?.cancel();
        response.status(503).json({
          ok: false,
          control: { ok: false, reason: "http_error", status: upstream.status },
        });
        return;
      }
      // Verify the Control contract, rather than accepting a proxy/login page.
      const body: unknown = await upstream.json();
      if (!body || typeof body !== "object" || !("ok" in body) || body.ok !== true) {
        response.status(503).json({
          ok: false,
          control: { ok: false, reason: "invalid_response" },
        });
        return;
      }
      response.json({
        ok: true,
        ...identity,
        control: { ok: true },
      });
    } catch (error) {
      // Do not expose upstream bodies, URLs or credentials through the probe.
      response.status(503).json({
        ok: false,
        control: {
          ok: false,
          reason: signal.aborted ? "timeout"
            : error instanceof SyntaxError ? "invalid_response" : "unreachable",
        },
      });
    }
  });
}
