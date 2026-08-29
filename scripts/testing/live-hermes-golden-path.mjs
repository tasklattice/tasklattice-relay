#!/usr/bin/env node

import {
  RelayClient,
  eventually,
  exchangeDashboardSession,
  probeRelayTerminal,
  runHermesDashboardTurn,
  waitForInstanceModelAttribution,
} from "./live-hermes-e2e-lib.mjs";

class BlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockedError";
  }
}

function requiredOptIn() {
  if (process.env.TALI_LIVE_E2E !== "1") {
    throw new BlockedError(
      "Set TALI_LIVE_E2E=1 to acknowledge that this test creates a real Hermes runtime and makes live model/embedding calls.",
    );
  }
}

function choose(items, configuredId, predicate, label) {
  const item = configuredId
    ? items.find((candidate) => candidate.id === configuredId)
    : items.find(predicate);
  if (!item) {
    throw new BlockedError(
      configuredId
        ? `${label} ${configuredId} is unavailable.`
        : `No suitable ${label} is configured.`,
    );
  }
  return item;
}

function unwrapInstance(payload) {
  return payload?.instance ?? payload;
}

function assertCostSafeRouting(routing) {
  const policy = routing.routingPolicy;
  if (!policy || policy.mode !== "SINGLE") {
    throw new BlockedError(
      "Live E2E requires a READY SINGLE Model Routing so it cannot fan out across a model matrix.",
    );
  }
  if ((policy.fallbackModelDeploymentIds ?? []).length) {
    throw new BlockedError(
      "Live E2E requires a Model Routing without fallback deployments to prevent cross-provider retry spend.",
    );
  }
  const maximumRetries = Number(process.env.TALI_LIVE_E2E_MAX_ROUTING_RETRIES ?? "2");
  if (!Number.isInteger(maximumRetries) || maximumRetries < 0 || maximumRetries > 2) {
    throw new Error("TALI_LIVE_E2E_MAX_ROUTING_RETRIES must be 0, 1, or 2.");
  }
  if ((policy.retries ?? 0) > maximumRetries) {
    throw new BlockedError(
      `The selected Routing allows ${policy.retries} retries; the live budget allows at most ${maximumRetries}.`,
    );
  }
  return {
    fallbackModels: 0,
    maximumHarnessTurns: 2,
    routingRetries: policy.retries ?? 0,
    routingMode: policy.mode,
    uploadedDocuments: 1,
  };
}

function allConversationText(page) {
  return (page?.items ?? []).flatMap((conversation) => [
    conversation.title,
    conversation.summary,
    ...(conversation.messages ?? []).map((message) => message.text),
  ]).filter(Boolean).join("\n");
}

async function main() {
  requiredOptIn();
  const baseUrl = process.env.TALI_BASE_URL ?? "http://127.0.0.1:18080";
  const username = process.env.TALI_VALIDATION_USERNAME ?? "admin";
  const password = process.env.TALI_VALIDATION_PASSWORD ?? "password";
  const timeoutMs = Number(process.env.TALI_LIVE_E2E_TIMEOUT_MS ?? "600000");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 30_000) {
    throw new Error("TALI_LIVE_E2E_TIMEOUT_MS must be at least 30000.");
  }
  const keepResources = process.env.TALI_LIVE_E2E_KEEP_RESOURCES === "1";
  const nonce = crypto.randomUUID().slice(0, 8);
  const vectorMarker = `ORBIT-${nonce.toUpperCase()}`;
  const memoryMarker = `PREFERENCE-${nonce.toUpperCase()}`;
  const responseMarker = `E2E-COMPLETE-${nonce.toUpperCase()}`;
  const client = new RelayClient(baseUrl);
  const cleanup = {
    agentId: undefined,
    databaseId: undefined,
    documentId: undefined,
    peerInstanceId: undefined,
  };
  const evidence = {};

  await client.login(username, password);
  const projects = await client.request("/api/v1/projects");
  const project = choose(
    projects,
    process.env.TALI_LIVE_E2E_PROJECT_ID,
    () => true,
    "Project",
  );
  await client.request("/api/v1/access-context", {
    method: "PUT",
    body: JSON.stringify({
      level: "project",
      resourceId: project.id,
      roleId: "ROLE_PROJECT_ADMIN",
    }),
  });

  try {
    const [routingPage, policyPage, catalog, garden] = await Promise.all([
      client.project(project.id, "/model-routings"),
      client.project(project.id, "/access-policies"),
      client.project(project.id, "/catalog"),
      client.project(project.id, "/agent-garden"),
    ]);
    const routing = choose(
      routingPage.data ?? routingPage,
      process.env.TALI_LIVE_E2E_ROUTING_ID,
      (candidate) => candidate.status === "READY"
        && candidate.routingPolicy?.mode === "SINGLE",
      "cost-safe READY SINGLE Model Routing",
    );
    evidence.costBudget = assertCostSafeRouting(routing);
    const accessPolicy = choose(
      policyPage.data ?? policyPage,
      process.env.TALI_LIVE_E2E_ACCESS_POLICY_ID,
      (candidate) => candidate.status === "ACTIVE",
      "ACTIVE Access Policy",
    );
    const vectorDatabase = choose(
      catalog.vectorDatabases ?? [],
      process.env.TALI_LIVE_E2E_VECTOR_DATABASE_ID,
      (candidate) => candidate.status === "REGISTERED" && candidate.provider === "postgresql",
      "registered PostgreSQL Vector Database",
    );
    cleanup.databaseId = vectorDatabase.id;

    let peer = (garden.instances ?? []).find(
      (candidate) => candidate.status === "READY" && candidate.a2a,
    );
    if (!peer) {
      const gardenAgent = choose(
        garden.agents ?? [],
        process.env.TALI_LIVE_E2E_A2A_AGENT_ID,
        (candidate) => candidate.status === "READY"
          && candidate.usageCapabilities?.acceptsDelegation,
        "READY callable A2A Agent",
      );
      peer = await client.project(
        project.id,
        `/agent-garden/agents/${encodeURIComponent(gardenAgent.id)}/instances`,
        { method: "POST" },
      );
      cleanup.peerInstanceId = peer.id;
      peer = await eventually(async () => {
        const snapshot = await client.project(project.id, "/agent-garden");
        const current = snapshot.instances?.find((candidate) => candidate.id === peer.id);
        if (current?.status === "FAILED") {
          throw new Error(`A2A peer failed to start: ${current.error ?? "unknown error"}`);
        }
        return current?.status === "READY" ? current : undefined;
      }, { description: "the A2A peer to become READY", timeoutMs });
    }
    evidence.a2aRegistry = { agentId: peer.agentId, instanceId: peer.id, status: peer.status };

    const sourceText = [
      "# TaskLattice live E2E vector document",
      "",
      `The validation constellation code is ${vectorMarker}.`,
      "This sentence exists only to prove document parsing, chunking, embedding, and semantic retrieval.",
    ].join("\n");
    const form = new FormData();
    form.set(
      "file",
      new Blob([sourceText], { type: "text/markdown" }),
      `tali-live-e2e-${nonce}.md`,
    );
    form.set("directoryPath", "/Live E2E");
    const queued = await client.project(
      project.id,
      `/catalog/vector-databases/${encodeURIComponent(vectorDatabase.id)}/documents`,
      { method: "POST", body: form },
    );
    cleanup.documentId = queued.document.id;
    const readyDocument = await eventually(async () => {
      const overview = await client.project(
        project.id,
        `/catalog/vector-databases/${encodeURIComponent(vectorDatabase.id)}`,
      );
      const document = overview.documents.find((candidate) => candidate.id === queued.document.id);
      if (document?.status === "FAILED") {
        throw new Error(`Vector ingestion failed: ${document.error ?? "unknown error"}`);
      }
      return document?.status === "READY" && document.chunkCount > 0 ? document : undefined;
    }, { description: "Docling chunking and embedding to finish", timeoutMs });
    const search = await client.project(
      project.id,
      `/catalog/vector-databases/${encodeURIComponent(vectorDatabase.id)}/search`,
      {
        method: "POST",
        body: JSON.stringify({
          query: `validation constellation code ${vectorMarker}`,
          topK: 4,
        }),
      },
    );
    if (!search.results?.some((result) => result.content.includes(vectorMarker))) {
      throw new Error("The uploaded Vector Database document was embedded but its marker was not retrieved.");
    }
    evidence.vectorDatabase = {
      chunkCount: readyDocument.chunkCount,
      databaseId: vectorDatabase.id,
      documentId: readyDocument.id,
      retrievedMarker: vectorMarker,
    };

    const inferenceStartedAt = new Date().toISOString();
    const creation = await client.project(project.id, "/instances", {
      method: "POST",
      headers: { "idempotency-key": `live-hermes-e2e:${nonce}` },
      body: JSON.stringify({
        name: `live-hermes-${nonce}`,
        description: "Disposable cross-plane live golden-path validation",
        runtime: "openshell",
        agentPlatform: "hermes",
        accessPolicyIds: [accessPolicy.id],
        modelRoutingId: routing.id,
        knowledgeSourceIds: [vectorDatabase.id],
        systemPrompt: "You are a strict TaskLattice validation coordinator. Follow explicit tool-use instructions and report concise evidence.",
      }),
    });
    cleanup.agentId = creation.instanceId;
    const agent = await eventually(async () => {
      const current = unwrapInstance(await client.project(
        project.id,
        `/instances/${encodeURIComponent(cleanup.agentId)}`,
      ));
      if (current?.status === "FAILED") {
        throw new Error(`Hermes failed to start: ${current.error ?? "inspect runtime logs"}`);
      }
      return current?.status === "READY" ? current : undefined;
    }, { description: "the Hermes Agent to become READY", timeoutMs });
    if (!agent.durableMemoryId) {
      throw new Error("The Hermes Agent did not receive a Durable Memory binding.");
    }

    const terminal = await client.project(
      project.id,
      `/instances/${encodeURIComponent(agent.id)}/terminal-sessions`,
      {
        method: "POST",
        body: JSON.stringify({ targetId: "agent" }),
      },
    );
    const ttyOutput = await probeRelayTerminal({
      baseUrl,
      websocketPath: terminal.websocketUrl,
      timeoutMs: Math.min(timeoutMs, 45_000),
    });
    evidence.tty = {
      connected: true,
      firstFrame: ttyOutput.slice(-240),
    };

    const interaction = await client.project(
      project.id,
      `/instances/${encodeURIComponent(agent.id)}/interaction`,
    );
    if (
      interaction.httpEndpoint?.kind !== "hermes-dashboard"
      || interaction.httpEndpoint?.status !== "READY"
      || !interaction.httpEndpoint?.url
    ) {
      throw new Error(`Hermes Dashboard is not READY: ${JSON.stringify(interaction)}`);
    }
    const dashboard = await exchangeDashboardSession(interaction.httpEndpoint.url);
    evidence.dashboard = {
      authenticatedChatPageStatus: dashboard.pageStatus,
      oneTimeAccessReplayStatus: 401,
    };

    const firstTurn = await runHermesDashboardTurn({
      ...dashboard,
      timeoutMs,
      requiredTools: ["a2a_list", "a2a_call", "vector_database_list", "vector_database_search"],
      responseIncludes: [vectorMarker, responseMarker],
      prompt: [
        "Perform this live acceptance flow with actual tools; do not simulate tool output.",
        "1. Call a2a_list, select a READY peer, create the required Kanban task assigned to tali-a2a, then call a2a_call asking the peer for a one-line health acknowledgement.",
        `2. Call vector_database_list and vector_database_search for database ${vectorDatabase.id}, querying \"validation constellation code ${vectorMarker}\".`,
        `3. Remember this durable user preference verbatim: ${memoryMarker}.`,
        `4. Report the retrieved code ${vectorMarker} and finish with ${responseMarker}.`,
      ].join("\n"),
    });
    evidence.hermesTools = firstTurn.tools;

    const retained = await eventually(async () => {
      const conversations = await client.project(
        project.id,
        `/memories/${encodeURIComponent(agent.durableMemoryId)}/conversations?limit=100&query=${encodeURIComponent(memoryMarker)}`,
      );
      return allConversationText(conversations).includes(memoryMarker)
        ? conversations
        : undefined;
    }, { description: "the Hermes turn to reach the configured Memory provider", timeoutMs });
    evidence.memory = {
      conversationCount: retained.totalCount,
      memoryId: agent.durableMemoryId,
      retainedMarker: memoryMarker,
    };

    const recallTurn = await runHermesDashboardTurn({
      ...dashboard,
      timeoutMs,
      responseIncludes: [memoryMarker],
      prompt: "In a fresh session, state the exact durable validation preference you remember. Do not use Vector Database or A2A tools.",
    });
    evidence.memory.recalledInFreshChat = recallTurn.response.includes(memoryMarker);
    evidence.modelAttribution = await waitForInstanceModelAttribution({
      instance: agent,
      projectRequest: (path, init) => client.project(project.id, path, init),
      routing,
      startedAt: inferenceStartedAt,
      timeoutMs,
    });

    const unauthenticated = await fetch(
      new URL(
        `/api/v1/projects/${encodeURIComponent(project.id)}/instances/${encodeURIComponent(agent.id)}/interaction`,
        baseUrl,
      ),
    );
    if (unauthenticated.status !== 401) {
      throw new Error(`Unauthenticated interaction access returned HTTP ${unauthenticated.status}, expected 401.`);
    }
    evidence.accessBoundary = { unauthenticatedInteractionStatus: unauthenticated.status };

    console.log(JSON.stringify({
      result: "PASS",
      level: "L4-live",
      plane: "cross-plane",
      projectId: project.id,
      agentId: agent.id,
      evidence,
    }, null, 2));
  } finally {
    if (!keepResources) {
      if (cleanup.agentId) {
        await client.project(project.id, `/instances/${encodeURIComponent(cleanup.agentId)}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
      if (cleanup.documentId) {
        if (cleanup.databaseId) {
          await client.project(
            project.id,
            `/catalog/vector-databases/${encodeURIComponent(cleanup.databaseId)}/documents/${encodeURIComponent(cleanup.documentId)}`,
            { method: "DELETE" },
          ).catch(() => undefined);
        }
      }
      if (cleanup.peerInstanceId) {
        await client.project(
          project.id,
          `/agent-garden/instances/${encodeURIComponent(cleanup.peerInstanceId)}`,
          { method: "DELETE" },
        ).catch(() => undefined);
      }
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
