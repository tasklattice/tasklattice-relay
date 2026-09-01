#!/usr/bin/env node

import { eventually, RelayClient } from "./live-hermes-e2e-lib.mjs";

const baseUrl = process.env.TALI_BASE_URL ?? "http://127.0.0.1:18080";
const projectId = process.env.TALI_LIVE_EXPERT_AGENT_PROJECT_ID ?? "proj1";
const username = process.env.TALI_VALIDATION_USERNAME ?? "admin";
const password = process.env.TALI_VALIDATION_PASSWORD ?? "password";
const coordinatorName = "Release 0 Hermes Expert Coordinator";

if (process.env.TALI_LIVE_HERMES_PROVISIONING !== "1") {
  throw new Error(
    "Set TALI_LIVE_HERMES_PROVISIONING=1 to authorize one persistent Hermes coordinator runtime for Project Registry validation.",
  );
}

function items(value) {
  return Array.isArray(value) ? value : value?.data ?? [];
}

function unwrap(value) {
  return value?.instance ?? value;
}

function contextOption(state, roleId) {
  return state.options.find((option) =>
    option.level === "project"
    && option.resourceId === projectId
    && option.roleId === roleId
  );
}

async function select(client, option) {
  await client.request("/api/v1/access-context", {
    method: "PUT",
    body: JSON.stringify({
      level: option.level,
      resourceId: option.resourceId,
      roleId: option.roleId,
    }),
  });
}

async function main() {
  const client = new RelayClient(baseUrl);
  await client.login(username, password);
  const accessContext = await client.request("/api/v1/access-context");
  const projectAdmin = contextOption(accessContext, "ROLE_PROJECT_ADMIN");
  const projectDeveloper = contextOption(accessContext, "ROLE_AGENT_DEVELOPER");
  if (!projectAdmin || !projectDeveloper) {
    throw new Error("The validation Account must have Project Administrator and Agent Developer contexts.");
  }
  await select(client, projectAdmin);

  try {
    const [instancePage, policyPage, routingPage] = await Promise.all([
      client.project(projectId, "/instances"),
      client.project(projectId, "/access-policies"),
      client.project(projectId, "/model-routings"),
    ]);
    const accessPolicy = items(policyPage).find((item) => item.status === "ACTIVE");
    const routing = items(routingPage).find((item) =>
      item.status === "READY"
      && item.routingPolicy?.mode === "SINGLE"
      && !(item.routingPolicy?.fallbackModelDeploymentIds ?? []).length
    );
    if (!accessPolicy) throw new Error("An ACTIVE Access Policy is required.");
    if (!routing) throw new Error("A READY, no-fallback SINGLE Model Routing is required.");

    let coordinator = items(instancePage).find((item) =>
      item.name === coordinatorName && item.agentPlatform === "hermes"
    );
    if (!coordinator) {
      const created = await client.project(projectId, "/instances", {
        method: "POST",
        headers: { "idempotency-key": "release0-hermes-expert-coordinator" },
        body: JSON.stringify({
          name: coordinatorName,
          description: "Persistent Project coordinator used to discover and delegate to released Expert Agents through the A2A Registry.",
          runtime: "openshell",
          agentPlatform: "hermes",
          accessPolicyIds: [accessPolicy.id],
          modelRoutingId: routing.id,
          knowledgeSourceIds: [],
          systemPrompt: "You are the Project Hermes coordinator. Discover active Expert Agents from the Registry and delegate only tasks matching their published A2A capabilities.",
        }),
      });
      coordinator = { id: created.instanceId, status: created.status ?? "CREATING" };
    }
    const ready = await eventually(async () => {
      const current = unwrap(await client.project(
        projectId,
        `/instances/${encodeURIComponent(coordinator.id)}`,
      ));
      if (current.status === "FAILED") {
        throw new Error(`Hermes coordinator failed: ${current.error ?? "inspect runtime reconciliation"}`);
      }
      return current.status === "READY" ? current : undefined;
    }, {
      description: "the Release 0 Hermes coordinator to become READY",
      intervalMs: 2_000,
      timeoutMs: Number(process.env.TALI_LIVE_HERMES_TIMEOUT_MS ?? "600000"),
    });

    await select(client, projectDeveloper);
    const agents = items(await client.project(projectId, "/expert-agents"));
    const activeDetails = [];
    for (const agent of agents) {
      const detail = await client.project(
        projectId,
        `/expert-agents/${encodeURIComponent(agent.id)}`,
      );
      if (detail.deployment?.status !== "READY") continue;
      if (!detail.registry?.discoveredByHermes) {
        throw new Error(`Active Expert Agent ${agent.slug} is not discoverable by Hermes.`);
      }
      activeDetails.push({
        id: agent.id,
        slug: agent.slug,
        activeVersionId: detail.deployment.activeVersionId,
        releaseId: detail.registry.activeVersion?.releaseId,
        registryEligible: detail.registry.eligible,
        discoveredByHermes: detail.registry.discoveredByHermes,
      });
    }
    if (activeDetails.length < 2) {
      throw new Error(`Expected at least two active Expert Agents; found ${activeDetails.length}.`);
    }

    console.log(JSON.stringify({
      projectId,
      coordinator: {
        id: ready.id,
        name: ready.name,
        status: ready.status,
        runtime: ready.runtime,
        agentPlatform: ready.agentPlatform,
        terminalOpened: false,
      },
      registry: {
        discoveredAgentCount: activeDetails.length,
        agents: activeDetails,
      },
    }, null, 2));
  } finally {
    await select(client, projectDeveloper);
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
