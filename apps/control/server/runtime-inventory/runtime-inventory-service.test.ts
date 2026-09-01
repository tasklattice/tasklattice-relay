import { describe, expect, it, vi } from "vitest";
import { RuntimeInventoryService } from "./runtime-inventory-service";

const owner = { id: "owner-1", displayName: "Agent Owner", username: "owner" };
const creator = { id: "creator-1", displayName: "Agent Creator", username: "creator" };

describe("RuntimeInventoryService", () => {
  it("merges Workspace, managed A2A, and current Project Agent runtimes", async () => {
    const projectAgentId = "10000000-0000-4000-8000-000000000001";
    const developedAgentId = "10000000-0000-4000-8000-000000000002";
    const versionId = "10000000-0000-4000-8000-000000000003";
    const listInstances = vi.fn().mockResolvedValue([{
      id: "workspace-1",
      name: "Hermes Coordinator",
      description: "Coordinates delegated work.",
      agentPlatform: "hermes",
      status: "READY",
      sandboxName: "i-hermes",
      createdAt: "2026-08-30T09:00:00.000Z",
      updatedAt: "2026-08-30T10:00:00.000Z",
    }]);
    const listManagedInstances = vi.fn().mockResolvedValue([{
      id: "a2a-1",
      agentId: "garden-1",
      name: "Catalog Agent",
      description: "Managed A2A runtime.",
      runtime: "kubernetes",
      status: "READY",
      runtimeNamespace: "tp-project",
      podName: "catalog-agent-abc",
      deploymentName: "catalog-agent",
      endpoint: "http://catalog-agent.tp-project.svc.cluster.local/a2a",
      createdAt: "2026-08-30T09:10:00.000Z",
      updatedAt: "2026-08-30T10:10:00.000Z",
    }]);
    const listGardenAgents = vi.fn().mockResolvedValue([{
      id: "garden-1",
      status: "READY",
      usageMode: "CALLABLE",
      usageCapabilities: {
        interactive: false,
        canDelegate: false,
        acceptsDelegation: true,
      },
      a2a: { protocolVersion: "1.0" },
    }]);
    const db = {
      agentRecord: {
        findMany: vi.fn().mockResolvedValueOnce([
          {
            id: "workspace-1",
            createdByUserId: "creator-1",
            ownerMembership: { user: owner },
            creatorMembership: { user: creator },
          },
          {
            id: "a2a-1",
            createdByUserId: null,
            ownerMembership: { user: owner },
            creatorMembership: null,
          },
        ]).mockResolvedValueOnce([{
          id: projectAgentId,
          payload: {
            id: projectAgentId,
            agentId: developedAgentId,
            kind: "PROJECT_AGENT",
            developedAgentId,
            versionId,
            versionNumber: 1,
            contentDigest: `sha256:${"a".repeat(64)}`,
            name: "GitHub Weekly Summary",
            description: "Summarizes weekly commits.",
            runtime: "kubernetes",
            status: "READY",
            runtimeNamespace: "tp-project",
            deploymentName: "expert-runtime",
            serviceName: "expert-runtime",
            podName: "expert-runtime-abc",
            labelSelector: "app=expert-runtime",
            imageReference: "tali-expert-agent-runtime:dev",
            imageDigest: null,
            endpoint: "http://expert-runtime.tp-project.svc.cluster.local:8080/a2a",
            agentCardUrl: "http://expert-runtime.tp-project.svc.cluster.local:8080/.well-known/agent-card.json",
            a2a: null,
            skills: [],
            createdAt: "2026-08-30T09:20:00.000Z",
            updatedAt: "2026-08-30T10:20:00.000Z",
            logs: [],
            error: null,
          },
          developedAgent: {
            id: developedAgentId,
            executionMode: "AGENTIC",
            creator: { user: creator },
            members: [{
              userId: "owner-1",
              relation: "OWNER",
              member: { user: owner },
            }],
          },
          agentVersion: { id: versionId, versionNumber: 1 },
          ownerMembership: { user: owner },
          creatorMembership: { user: creator },
        }]),
      },
    };
    const service = new RuntimeInventoryService(
      "project-1",
      db as never,
      { list: listInstances } as never,
      { store: { listManagedInstances, listAgents: listGardenAgents } } as never,
    );

    const result = await service.list("owner-1");

    expect(result.data.map((item) => item.sourceType).sort()).toEqual([
      "MANAGED_A2A",
      "PROJECT_AGENT",
      "WORKSPACE_INSTANCE",
    ]);
    expect(listInstances).toHaveBeenCalledWith("owner-1");
    expect(listManagedInstances).toHaveBeenCalledWith("owner-1");
    expect(result.data.find((item) => item.sourceId === "workspace-1")?.ownership).toMatchObject({
      createdBy: creator,
      creatorProvenance: "RECORDED",
      owners: [owner],
    });
    expect(result.data.find((item) => item.sourceId === "a2a-1")?.ownership.creatorProvenance).toBe(
      "INFERRED_FROM_OWNER",
    );
    expect(result.data.find((item) => item.sourceId === projectAgentId)).toMatchObject({
      relation: "OWNER",
      classification: {
        form: "SERVICE",
        role: "SPECIALIST",
        executionStrategy: "AGENTIC",
        a2a: { directions: ["SERVER"], agentCardStatus: "VALID" },
      },
      activeVersion: { id: versionId, versionNumber: 1 },
      runtime: { namespace: "tp-project", workloadName: "expert-runtime" },
      ownership: { lastDeployedBy: creator },
    });
  });

  it("does not turn an Agent without a current Version into an Instance", async () => {
    const service = new RuntimeInventoryService(
      "project-1",
      {
        agentRecord: { findMany: vi.fn().mockResolvedValue([]) },
        expertAgentRecord: {
          findMany: vi.fn().mockResolvedValue([{
            id: "draft-1",
            deployment: { activeVersionId: null },
            activations: [],
          }]),
        },
      } as never,
      { list: vi.fn().mockResolvedValue([]) } as never,
      { store: {
        listManagedInstances: vi.fn().mockResolvedValue([]),
        listAgents: vi.fn().mockResolvedValue([]),
      } } as never,
    );

    expect((await service.list()).data).toEqual([]);
  });
});
