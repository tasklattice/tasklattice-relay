import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentGardenService } from "../agent-garden/agent-garden-service";
import { AgentGardenStore } from "../agent-garden/agent-garden-store";
import { projectRouteAdmissionPolicy } from "../authorization/route-capabilities";
import {
  instanceConfigurationView,
  instanceInteractionAccess,
} from "../instances/instance-http-view";
import { ProjectAgentRuntimeService } from "../runtime-bridge/project-agent-runtime-service";
import { ProjectMemoryRuntimeService } from "../runtime-bridge/project-memory-runtime-service";
import { ProjectVectorDatabaseRuntimeService } from "../runtime-bridge/project-vector-database-runtime-service";
import {
  configuredService,
  createConfiguredInstance,
} from "../test/configured-agent-service";

afterEach(() => {
  vi.restoreAllMocks();
});

async function instantiateExternalPeer(
  garden: AgentGardenService,
  agentId: string,
) {
  await garden.snapshot();
  const agent = await garden.store.getAgent(agentId);
  if (!agent) throw new Error(`Missing Agent Garden fixture: ${agentId}`);
  const configuration = { ...agent.configuration };
  for (const key of [
    "onboardingSource",
    "imageReference",
    "containerPort",
    "agentCardPath",
    "imagePullSecretName",
    "command",
    "args",
    "runtimeOwnership",
  ]) {
    delete configuration[key];
  }
  await garden.store.saveAgent({ ...agent, configuration });
  return garden.instantiate(agentId, "local-admin");
}

describe("Agent deterministic golden path", () => {
  it("connects Hermes, Knowledge, A2A, Memory, permissions and deletion", async () => {
    const interactionUrl =
      "https://hermes.example/chat?access_token=short-lived-secret";
    const setup = await configuredService({
      httpEndpoint: {
        kind: "hermes-dashboard",
        status: "READY",
        url: interactionUrl,
      },
    });
    const agent = await createConfiguredInstance(setup, {
      agentPlatform: "hermes",
      name: "Hermes Knowledge Coordinator",
    });

    expect(agent).toMatchObject({
      agentPlatform: "hermes",
      status: "READY",
      durableMemoryId: expect.any(String),
      knowledgeSourceIds: ["engineering-handbook"],
      accessPolicyIds: [setup.policy.id],
    });
    expect(setup.litellm.createInstanceServiceAccountKey)
      .toHaveBeenCalledWith(expect.objectContaining({
        models: ["tali-routing-routing-a"],
        objectPermissions: expect.objectContaining({
          vectorStores: ["vs_engineering_handbook"],
        }),
      }));

    const vectorCatalog = {
      searchVectorDatabase: vi.fn(async () => ({
        query: "deployment rollback",
        durationMs: 5,
        results: [{
          id: "handbook-chunk-1",
          chunkId: "handbook-chunk-1",
          documentId: "handbook-document-1",
          content: "Rollback requires an incident note and an owner.",
          filename: "engineering-handbook.pdf",
          directoryPath: "/Runbooks",
          score: 0.97,
          pageNumber: 12,
          chunkIndex: 3,
          sectionPath: ["Deployments", "Rollback"],
          attributes: { privateProviderMetadata: "not exposed" },
        }],
      })),
    };
    const vectorRuntime = new ProjectVectorDatabaseRuntimeService(
      setup.store.projectId,
      { catalog: vectorCatalog, store: setup.store },
    );
    await expect(vectorRuntime.search(
      agent.id,
      "engineering-handbook",
      { query: "deployment rollback", topK: 4 },
    )).resolves.toEqual({
      query: "deployment rollback",
      durationMs: 5,
      results: [{
        id: "handbook-chunk-1",
        content: "Rollback requires an incident note and an owner.",
        filename: "engineering-handbook.pdf",
        score: 0.97,
        pageNumber: 12,
        sectionPath: ["Deployments", "Rollback"],
      }],
    });

    const garden = new AgentGardenService(
      new AgentGardenStore(setup.store.projectId, setup.store.database()),
    );
    const peer = await instantiateExternalPeer(
      garden,
      "a2a-github-daily-triage",
    );
    const a2a = new ProjectAgentRuntimeService(
      setup.store.projectId,
      setup.store.database(),
    );
    await expect(a2a.listPeers(agent.id)).resolves.toContainEqual(
      expect.objectContaining({ id: peer.id, protocolVersion: "1.0" }),
    );
    const a2aResponse = {
      jsonrpc: "2.0",
      id: "golden-dispatch",
      result: {
        message: {
          role: "ROLE_AGENT",
          parts: [{ text: "Triage complete: no release blockers." }],
        },
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      JSON.stringify(a2aResponse),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await expect(a2a.sendMessage(agent.id, peer.id, {
      jsonrpc: "2.0",
      id: "golden-dispatch",
      method: "SendMessage",
      params: {
        message: {
          messageId: "golden-message",
          role: "ROLE_USER",
          parts: [{ text: "Check today's release blockers." }],
        },
      },
    })).resolves.toEqual({ status: 200, body: a2aResponse });

    const memoryId = agent.durableMemoryId!;
    const memoryRuntime = new ProjectMemoryRuntimeService(
      setup.store.projectId,
      { memories: setup.memories, repository: setup.memories.repository },
    );
    await expect(memoryRuntime.retain({
      projectId: setup.store.projectId,
      namespace: "tp-individual",
      coordinatorInstanceId: agent.id,
      memoryId,
    }, {
      conversationId: "golden-turn",
      user: "Check today's release blockers and the rollback requirements.",
      toolSummaries: [
        "A2A GitHub Daily Triage: no release blockers.",
        "engineering-handbook.pdf page 12: an incident note and owner are required.",
      ],
      assistant: "No blockers. Record an incident note and owner for rollback.",
    })).resolves.toMatchObject({ accepted: true });
    await expect(setup.memories.processDueOutbox())
      .resolves.toMatchObject({ delivered: 1 });
    await expect(setup.memories.processDueOutbox())
      .resolves.toMatchObject({ delivered: 0 });
    const memoryBeforeDelete = await setup.memories.repository.getMemory(memoryId);
    expect(setup.memoryProvider.conversationCount(
      memoryBeforeDelete!.providerRef!,
    )).toBe(1);

    expect(projectRouteAdmissionPolicy(
      "GET",
      `/api/v1/projects/${setup.store.projectId}/instances/${agent.id}/interaction`,
    )).toMatchObject({
      relation: "INSTANCE",
      resourceId: agent.id,
      requirements: [{
        capability: "CAP_AGENT_INSTANCE_INTERACT",
        resourceType: "AgentInstance",
      }],
    });
    expect(JSON.stringify(instanceConfigurationView(agent)))
      .not.toContain("short-lived-secret");
    expect(instanceInteractionAccess(agent).httpEndpoint?.url)
      .toBe(interactionUrl);

    await expect(setup.service.destroy(agent.id)).resolves.toBe(true);
    await setup.service.deleteRuntime(agent.id);
    await expect(setup.memories.repository.getMemory(memoryId))
      .resolves.toMatchObject({
        id: memoryId,
        providerRef: memoryBeforeDelete!.providerRef,
        status: "unbound",
      });
    expect(setup.memoryProvider.hasBank(memoryBeforeDelete!.providerRef!))
      .toBe(true);
    expect(setup.memoryProvider.conversationCount(
      memoryBeforeDelete!.providerRef!,
    )).toBe(1);
    await expect(setup.memories.repository.countBindings(memoryId, "detached"))
      .resolves.toBe(1);
  });
});
