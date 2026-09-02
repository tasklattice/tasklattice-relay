import type { ExpertAgentDefinitionInput, ExpertAgentTestEvidence } from "@tali/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentGardenService } from "../agent-garden/agent-garden-service";
import { AgentGardenStore } from "../agent-garden/agent-garden-store";
import type { PrismaClient } from "../generated/prisma/client";
import type { ExpertAgentRuntimeClient } from "../kubernetes/expert-agent-runtime-client";
import { createTestStore } from "../test/store";
import {
  ExpertAgentDeleteBlockedError,
  ExpertAgentLifecycleService,
  ExpertAgentPublishGateError,
} from "./expert-agent-lifecycle-service";
import { ExpertAgentDeveloperService } from "./expert-agent-developer-service";

let database: PrismaClient | undefined;

afterEach(async () => {
  await database?.$disconnect();
  database = undefined;
});

function definition(expectedRevision = 0): ExpertAgentDefinitionInput {
  return {
    expectedRevision,
    delegations: [],
    product: {
      name: "Grounded Customer Support",
      purpose: "Answer supported customer questions from approved knowledge.",
      targetUsers: ["Support teams"],
      capabilities: ["Answer with citations"],
      outOfScope: ["Invent an answer"],
      inputContract: { type: "object" },
      outputContract: { type: "object" },
    },
    policy: {
      preset: "CONTROLLED",
      groundingPolicy: "REQUIRED",
      outputMode: "STRUCTURED",
      actionPolicy: "ALLOWLIST",
    },
    acceptance: {
      cases: [{
        id: "grounded-answer",
        title: "Returns a grounded answer",
        kind: "HAPPY_PATH",
        given: "Approved knowledge contains an answer",
        when: "A supported question is submitted",
        then: ["The answer includes a citation"],
        required: true,
      }],
      minimumRequiredPassRate: 1,
    },
    safety: {
      guardrails: [{
        id: "no-invention",
        category: "GROUNDING",
        rule: "Do not answer without approved evidence.",
        violationBehavior: "REJECT",
        required: true,
      }],
      prohibitedBehaviors: ["Invent support policy"],
      noEvidenceBehavior: "UNKNOWN",
      allowGeneralModelFallback: false,
    },
    execution: {
      mode: "AGENTIC",
      engine: { framework: "GOOGLE_ADK", version: "2.0" },
      modelRoutingId: "project-default",
      instruction: "Use approved evidence and cite it.",
      configuration: {},
      maxSteps: 8,
      timeoutMs: 60_000,
    },
    resources: [],
  };
}

function passedPublishTest(agentDigest: string): ExpertAgentTestEvidence {
  return {
    agentDigest,
    mode: "RELEASE",
    status: "PASSED",
    summary: "All required checks passed.",
    assertions: [{
      id: "grounded-answer",
      passed: true,
      message: "The required acceptance case passed.",
    }],
    artifacts: [],
    startedAt: "2026-08-31T01:00:00.000Z",
    finishedAt: "2026-08-31T01:01:00.000Z",
  };
}

describe("Agent Developer lifecycle", () => {
  it("shares Agent definitions across Project Developers", async () => {
    const store = createTestStore();
    database = store.database();
    const lifecycle = new ExpertAgentLifecycleService(database);
    const agent = await lifecycle.createAgent({
      projectId: store.projectId,
      actorId: "local-admin",
      slug: "shared-project-agent",
      executionMode: "AGENTIC",
      definition: definition(),
    });
    await database.user.create({
      data: {
        id: "project-developer",
        username: "project-developer",
        email: "project-developer@example.test",
        displayName: "Project Developer",
      },
    });
    await database.projectMember.create({
      data: {
        projectId: store.projectId,
        userId: "project-developer",
        role: "developer",
      },
    });

    const developer = new ExpertAgentDeveloperService(database);
    await expect(developer.list(store.projectId, "project-developer"))
      .resolves.toEqual([
        expect.objectContaining({ id: agent.id, slug: "shared-project-agent" }),
      ]);
    const changed = definition(0);
    changed.product = {
      ...changed.product,
      purpose: "Answer supported questions from shared approved knowledge.",
    };
    await expect(lifecycle.updateAgent({
      projectId: store.projectId,
      agentId: agent.id,
      actorId: "project-developer",
      definition: changed,
    })).resolves.toMatchObject({ revision: 1, updatedBy: "project-developer" });
  });

  it("deletes an unpublished Agent and its development history", async () => {
    const store = createTestStore();
    database = store.database();
    const lifecycle = new ExpertAgentLifecycleService(database);
    const agent = await lifecycle.createAgent({
      projectId: store.projectId,
      actorId: "local-admin",
      slug: "temporary-agent",
      executionMode: "AGENTIC",
      definition: definition(),
    });
    await lifecycle.recordTestRun({
      projectId: store.projectId,
      agentId: agent.id,
      actorId: "local-admin",
      agentRevision: agent.revision,
      evidence: passedPublishTest(agent.contentDigest),
    });

    await expect(lifecycle.deleteAgent({
      projectId: store.projectId,
      agentId: agent.id,
      actorId: "local-admin",
    })).resolves.toEqual({ id: agent.id, deleted: true });
    await expect(database.expertAgentRecord.count({
      where: { projectId: store.projectId, id: agent.id },
    })).resolves.toBe(0);
    await expect(database.expertAgentTestRunRecord.count({
      where: { projectId: store.projectId, agentId: agent.id },
    })).resolves.toBe(0);
  });

  it("publishes only the tested current digest and does not create an Instance", async () => {
    const store = createTestStore();
    database = store.database();
    const lifecycle = new ExpertAgentLifecycleService(database);
    const agent = await lifecycle.createAgent({
      projectId: store.projectId,
      actorId: "local-admin",
      slug: "grounded-customer-support",
      executionMode: "AGENTIC",
      definition: definition(),
    });

    await expect(lifecycle.publishAgent({
      projectId: store.projectId,
      agentId: agent.id,
      actorId: "local-admin",
      expectedRevision: 0,
    })).rejects.toBeInstanceOf(ExpertAgentPublishGateError);

    await lifecycle.recordTestRun({
      projectId: store.projectId,
      agentId: agent.id,
      actorId: "local-admin",
      agentRevision: agent.revision,
      evidence: passedPublishTest(agent.contentDigest),
    });
    const version = await lifecycle.publishAgent({
      projectId: store.projectId,
      agentId: agent.id,
      actorId: "local-admin",
      expectedRevision: 0,
      publicationNotes: "First Garden publication.",
    });

    expect(version).toMatchObject({
      agentId: agent.id,
      versionNumber: 1,
      contentDigest: agent.contentDigest,
      gardenStatus: "PUBLISHED",
    });
    await expect(database.expertAgentVersionArtifactRecord.count({
      where: { projectId: store.projectId, versionId: version.id },
    })).resolves.toBe(4);
    await expect(database.agentRecord.count({
      where: { projectId: store.projectId, kind: "PROJECT_AGENT" },
    })).resolves.toBe(0);

    const changed = definition(0);
    changed.product = {
      ...changed.product,
      purpose: "Answer and triage supported questions from approved knowledge.",
    };
    await lifecycle.updateAgent({
      projectId: store.projectId,
      agentId: agent.id,
      actorId: "local-admin",
      definition: changed,
    });
    await expect(lifecycle.publishAgent({
      projectId: store.projectId,
      agentId: agent.id,
      actorId: "local-admin",
      expectedRevision: 1,
    })).rejects.toMatchObject({
      code: "expert_agent_publish_gate_failed",
      details: { reason: "TESTS_OUTDATED" },
    });
  });

  it("materializes multiple independent Instances from one Garden Version", async () => {
    const store = createTestStore();
    database = store.database();
    const lifecycle = new ExpertAgentLifecycleService(database);
    const agent = await lifecycle.createAgent({
      projectId: store.projectId,
      actorId: "local-admin",
      slug: "grounded-customer-support",
      executionMode: "AGENTIC",
      definition: definition(),
    });
    await lifecycle.recordTestRun({
      projectId: store.projectId,
      agentId: agent.id,
      actorId: "local-admin",
      agentRevision: agent.revision,
      evidence: passedPublishTest(agent.contentDigest),
    });
    const version = await lifecycle.publishAgent({
      projectId: store.projectId,
      agentId: agent.id,
      actorId: "local-admin",
      expectedRevision: 0,
    });
    await database.projectRuntimeTarget.create({
      data: {
        projectId: store.projectId,
        clusterId: "in-cluster",
        namespace: "tp-abcdefghijklmnop",
        status: "ready",
      },
    });
    const activate = vi.fn(async (input: Parameters<ExpertAgentRuntimeClient["activate"]>[0]) => ({
      endpoint: `http://agent-${input.instanceId}.${input.namespace}.svc.cluster.local:8080/a2a`,
      resourceName: `agent-${input.instanceId}`,
      engineVersion: "test-runtime-1",
    }));
    const deactivate = vi.fn(async () => undefined);
    const runtime: ExpertAgentRuntimeClient = {
      activate,
      deactivate,
    };
    const garden = new AgentGardenService(
      new AgentGardenStore(store.projectId, database),
      store,
      undefined,
      undefined,
      undefined,
      runtime,
    );

    const catalog = await garden.snapshot("local-admin");
    expect(catalog.agents.find((entry) => entry.id === agent.id)).toMatchObject({
      source: "PROJECT_DEVELOPED",
      endpoint: null,
      distribution: {
        type: "VERSION_BUNDLE",
        defaultVersionId: version.id,
      },
    });
    const first = await garden.instantiate(agent.id, "local-admin", version.id);
    const second = await garden.instantiate(agent.id, "local-admin", version.id);

    expect(first.id).not.toBe(second.id);
    expect([first, second]).toEqual([
      expect.objectContaining({ status: "READY", versionId: version.id }),
      expect.objectContaining({ status: "READY", versionId: version.id }),
    ]);
    expect(activate).toHaveBeenCalledTimes(2);
    expect(new Set(activate.mock.calls.map(([input]) => input.instanceId)).size).toBe(2);
    await expect(garden.snapshot("local-admin")).resolves.toMatchObject({
      instances: expect.arrayContaining([
        expect.objectContaining({ id: first.id, kind: "PROJECT_AGENT", versionId: version.id }),
        expect.objectContaining({ id: second.id, kind: "PROJECT_AGENT", versionId: version.id }),
      ]),
    });
    await expect(database.agentRecord.count({
      where: {
        projectId: store.projectId,
        kind: "PROJECT_AGENT",
        developedAgentId: agent.id,
        agentVersionId: version.id,
      },
    })).resolves.toBe(2);

    await expect(lifecycle.deleteAgent({
      projectId: store.projectId,
      agentId: agent.id,
      actorId: "local-admin",
    })).rejects.toBeInstanceOf(ExpertAgentDeleteBlockedError);

    await expect(garden.removeInstance(first.id)).resolves.toBe(true);
    expect(deactivate).toHaveBeenCalledWith({
      namespace: "tp-abcdefghijklmnop",
      instanceId: first.id,
    });
    await expect(database.agentRecord.findUniqueOrThrow({
      where: {
        projectId_id: { projectId: store.projectId, id: first.id },
      },
      select: { deletedAt: true },
    })).resolves.toEqual({ deletedAt: expect.any(Date) });

    await expect(garden.removeInstance(second.id)).resolves.toBe(true);
    await expect(lifecycle.deleteAgent({
      projectId: store.projectId,
      agentId: agent.id,
      actorId: "local-admin",
    })).resolves.toEqual({ id: agent.id, deleted: true });
    await expect(database.expertAgentVersionRecord.count({
      where: { projectId: store.projectId, agentId: agent.id },
    })).resolves.toBe(0);
  });
});
