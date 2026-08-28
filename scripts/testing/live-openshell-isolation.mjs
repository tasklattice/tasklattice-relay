#!/usr/bin/env node

import {
  RelayClient,
  eventually,
  expectWebSocketHttpStatus,
  probeRelayTerminal,
} from "./live-hermes-e2e-lib.mjs";

class BlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockedError";
  }
}

function pageItems(value) {
  return value?.data ?? value ?? [];
}

async function main() {
  if (process.env.TALI_LIVE_E2E !== "1") {
    throw new BlockedError(
      "Set TALI_LIVE_E2E=1 before testing a deployed OpenShell tenant boundary.",
    );
  }
  const baseUrl = process.env.TALI_BASE_URL ?? "http://127.0.0.1:18080";
  const timeoutMs = Number(process.env.TALI_LIVE_E2E_TIMEOUT_MS ?? "300000");
  const client = new RelayClient(baseUrl);
  await client.login(
    process.env.TALI_VALIDATION_USERNAME ?? "admin",
    process.env.TALI_VALIDATION_PASSWORD ?? "password",
  );
  const projects = await client.request("/api/v1/projects");
  const project = process.env.TALI_LIVE_E2E_PROJECT_ID
    ? projects.find((candidate) => candidate.id === process.env.TALI_LIVE_E2E_PROJECT_ID)
    : projects[0];
  if (!project) throw new BlockedError("No validation Project is available.");
  await client.request("/api/v1/access-context", {
    method: "PUT",
    body: JSON.stringify({
      level: "project",
      resourceId: project.id,
      roleId: "ROLE_PROJECT_ADMIN",
    }),
  });

  let createdAgentId;
  let agent = pageItems(await client.project(project.id, "/instances"))
    .find((candidate) => candidate.runtime === "openshell" && candidate.status === "READY");
  try {
    if (!agent) {
      const [routings, policies] = await Promise.all([
        client.project(project.id, "/model-routings"),
        client.project(project.id, "/access-policies"),
      ]);
      const routing = pageItems(routings).find((candidate) => candidate.status === "READY");
      const policy = pageItems(policies).find((candidate) => candidate.status === "ACTIVE");
      if (!routing || !policy) {
        throw new BlockedError(
          "OpenShell isolation needs either a READY Agent or one READY Routing and ACTIVE Access Policy.",
        );
      }
      const created = await client.project(project.id, "/instances", {
        method: "POST",
        headers: { "idempotency-key": `live-openshell-isolation:${crypto.randomUUID()}` },
        body: JSON.stringify({
          name: `isolation-${Date.now().toString().slice(-6)}`,
          description: "Disposable OpenShell tenant isolation probe",
          runtime: "openshell",
          agentPlatform: "openclaw",
          accessPolicyIds: [policy.id],
          modelRoutingId: routing.id,
          systemPrompt: "Do not make model calls during this isolation probe.",
        }),
      });
      createdAgentId = created.instanceId;
      agent = await eventually(async () => {
        const payload = await client.project(
          project.id,
          `/instances/${encodeURIComponent(createdAgentId)}`,
        );
        const current = payload.instance ?? payload;
        if (current.status === "FAILED") {
          throw new Error(`Isolation Agent failed to start: ${current.error ?? "unknown error"}`);
        }
        return current.status === "READY" ? current : undefined;
      }, { description: "the isolation Agent to become READY", timeoutMs });
    }

    const rejectedSession = await client.project(
      project.id,
      `/instances/${encodeURIComponent(agent.id)}/terminal-sessions`,
      { method: "POST", body: JSON.stringify({ targetId: "agent" }) },
    );
    const foreignProjectId = `${project.id}-foreign-tenant`;
    const tamperedPath = rejectedSession.websocketUrl.replace(
      `/projects/${encodeURIComponent(project.id)}/`,
      `/projects/${encodeURIComponent(foreignProjectId)}/`,
    );
    if (tamperedPath === rejectedSession.websocketUrl) {
      throw new Error("Unable to construct the cross-Project terminal probe.");
    }
    const websocketStatus = await expectWebSocketHttpStatus({
      baseUrl,
      websocketPath: tamperedPath,
      expectedStatus: 401,
    });

    const apiResponse = await client.rawRequest(
      `/api/v1/projects/${encodeURIComponent(foreignProjectId)}/instances/${encodeURIComponent(agent.id)}`,
    );
    if (![403, 404].includes(apiResponse.status)) {
      throw new Error(
        `Cross-Project Instance lookup returned HTTP ${apiResponse.status}; expected 403 or 404.`,
      );
    }

    const validSession = await client.project(
      project.id,
      `/instances/${encodeURIComponent(agent.id)}/terminal-sessions`,
      { method: "POST", body: JSON.stringify({ targetId: "agent" }) },
    );
    await probeRelayTerminal({
      baseUrl,
      websocketPath: validSession.websocketUrl,
      timeoutMs: Math.min(timeoutMs, 45_000),
    });

    console.log(JSON.stringify({
      result: "PASS",
      level: "L3-live",
      module: "openshell-isolation",
      evidence: {
        agentId: agent.id,
        apiCrossProjectStatus: apiResponse.status,
        projectId: project.id,
        scopedTerminalConnected: true,
        tamperedTerminalStatus: websocketStatus,
      },
    }, null, 2));
  } finally {
    if (createdAgentId && process.env.TALI_LIVE_E2E_KEEP_RESOURCES !== "1") {
      await client.project(
        project.id,
        `/instances/${encodeURIComponent(createdAgentId)}`,
        { method: "DELETE" },
      ).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  const blocked = error instanceof BlockedError;
  console.error(JSON.stringify({
    result: blocked ? "BLOCKED" : "FAIL",
    reason: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = blocked ? 2 : 1;
});
