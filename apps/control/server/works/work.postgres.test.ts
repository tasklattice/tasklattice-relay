import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, beforeAll, afterAll, it, expect, vi } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import {
  WorkService,
  workJson,
  lockWork,
  appendWorkEvent,
} from "./work-service";
import { WorkWorker } from "./work-worker";
import { workHash } from "./work-domain";
import {
  workStateSchema,
  type WorkCommand,
  type WorkTask,
  type ExpertAgentDefinition,
} from "@tali/contracts";
import {
  buildExpertAgentVersionSnapshot,
  expertAgentContentDigest,
} from "../expert-agents/expert-agent-domain";

const url = process.env.WORK_TEST_DATABASE_URL;
describe.skipIf(!url)(
  "Work real PostgreSQL integration (isolated synthetic data)",
  () => {
    let db: PrismaClient, service: WorkService;
    const suffix = randomUUID().slice(0, 8),
      p = `work-test-${suffix}`,
      u = `work-one-${suffix}`,
      v = `work-two-${suffix}`,
      outsider = `work-other-${suffix}`;
    const agentId = randomUUID(),
      versionId = randomUUID(),
      instanceId = `work-instance-${suffix}`;
    let workId: string;
    async function send(action: WorkCommand["action"], actor = u) {
      const snapshot = await service.snapshot(p, workId, actor);
      return service.command(p, workId, actor, {
        expectedRevision: snapshot.revision,
        idempotencyKey: randomUUID(),
        action,
      });
    }
    beforeAll(async () => {
      if (
        !url ||
        !new URL(url).hostname.match(/^(127\.0\.0\.1|localhost)$/) ||
        !new URL(url).pathname.includes("relay_work")
      )
        throw new Error("Use an isolated local relay_work database");
      db = new PrismaClient({
        adapter: new PrismaPg(
          { connectionString: url },
          { schema: "tasklattice" },
        ),
      });
      service = new WorkService(db);
      for (const id of [u, v, outsider])
        await db.user.create({
          data: { id, email: `${id}@example.invalid`, displayName: "同名用户" },
        });
      await db.project.create({
        data: { id: p, name: p, departmentId: "dep1", createdBy: u },
      });
      for (const id of [u, v, outsider])
        await db.projectMember.create({
          data: { projectId: p, userId: id, role: "user" },
        });
      const definition: ExpertAgentDefinition = {
        delegations: [],
        product: {
          name: "TEST ONLY expert",
          purpose: "Synthetic integration adapter",
          targetUsers: ["Test"],
          capabilities: ["Draft"],
          outOfScope: ["External side effects"],
          inputContract: { type: "object" },
          outputContract: { type: "object" },
        },
        policy: {
          preset: "FLEXIBLE",
          groundingPolicy: "OPTIONAL",
          outputMode: "STRUCTURED",
          actionPolicy: "ALLOWLIST",
        },
        acceptance: {
          cases: [
            {
              id: "draft",
              title: "Draft",
              kind: "HAPPY_PATH",
              given: "Intent",
              when: "Called",
              then: ["Draft"],
              required: true,
            },
          ],
          minimumRequiredPassRate: 1,
        },
        safety: {
          guardrails: [
            {
              id: "isolation",
              category: "TOOL_USE",
              rule: "No external tools",
              violationBehavior: "REJECT",
              required: true,
            },
          ],
          prohibitedBehaviors: ["External writes"],
          noEvidenceBehavior: "UNKNOWN",
          allowGeneralModelFallback: false,
        },
        execution: {
          mode: "AGENTIC",
          engine: { framework: "GOOGLE_ADK", version: "2.0" },
          modelRoutingId: "test-only-routing",
          instruction: "Test",
          configuration: {},
          maxSteps: 1,
          timeoutMs: 60000,
        },
        resources: [],
      };
      const snapshot = buildExpertAgentVersionSnapshot({ agentId, definition });
      await db.expertAgentRecord.create({
        data: {
          projectId: p,
          id: agentId,
          slug: `test-${suffix}`,
          name: "TEST ONLY",
          description: "Test",
          executionMode: "AGENTIC",
          contentDigest: expertAgentContentDigest(snapshot),
          productSpec: workJson(definition.product),
          policySpec: workJson(definition.policy),
          acceptanceSpec: workJson(definition.acceptance),
          safetySpec: workJson(definition.safety),
          executionSpec: workJson(definition.execution),
          createdBy: u,
          updatedBy: u,
        },
      });
      await db.expertAgentVersionRecord.create({
        data: {
          projectId: p,
          id: versionId,
          agentId,
          versionNumber: 1,
          sourceRevision: 0,
          contentDigest: expertAgentContentDigest(snapshot),
          snapshot: workJson(snapshot),
          manifest: {},
          manifestDigest: `sha256:${"0".repeat(64)}`,
          artifactSetDigest: `sha256:${"0".repeat(64)}`,
          publishedBy: u,
        },
      });
      await db.agentRecord.create({
        data: {
          projectId: p,
          id: instanceId,
          kind: "PROJECT_AGENT",
          developedAgentId: agentId,
          agentVersionId: versionId,
          payload: { status: "READY" },
          ownerUserId: u,
          createdAt: new Date(),
        },
      });
      workId = (
        await service.create(p, u, {
          title: "持久化测试",
          goal: "Synthetic test only",
          idempotencyKey: randomUUID(),
        })
      ).id;
    });
    afterAll(async () => {
      if (db) {
        await db.project.delete({ where: { id: p } });
        await db.user.deleteMany({ where: { id: { in: [u, v, outsider] } } });
        await db.$disconnect();
      }
    });
    it("persists zero-task chat across new clients, allows two trusted humans, denies outsiders", async () => {
      expect((await service.snapshot(p, workId, u)).state.tasks).toHaveLength(
        0,
      );
      await send({ type: "message", text: "先聊一聊", source: "text" });
      await send({ type: "members", userIds: [u, v] });
      await send({ type: "message", text: "第二位用户", source: "text" }, v);
      const second = new PrismaClient({
        adapter: new PrismaPg(
          { connectionString: url! },
          { schema: "tasklattice" },
        ),
      });
      const saved = await new WorkService(second).snapshot(p, workId, v);
      expect(saved.messages.map((m) => m.userId)).toEqual([u, v]);
      expect(saved.state.tasks).toHaveLength(0);
      await second.$disconnect();
      await expect(service.snapshot(p, workId, outsider)).rejects.toMatchObject(
        { status: 404 },
      );
      await expect(
        service.events(p, workId, outsider, 0),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.snapshot("foreign-project", workId, u),
      ).rejects.toMatchObject({ status: 403 });
      expect(await service.list(p, outsider)).toEqual([]);
    });
    it("deduplicates concurrent commands, rejects changed payload and stale revisions", async () => {
      const s = await service.snapshot(p, workId, u);
      const cmd = {
        expectedRevision: s.revision,
        idempotencyKey: randomUUID(),
        action: { type: "message", text: "once", source: "text" },
      };
      await Promise.all([
        service.command(p, workId, u, cmd),
        service.command(p, workId, u, cmd),
      ]);
      expect(
        (await service.snapshot(p, workId, u)).messages.filter(
          (m) => m.text === "once",
        ),
      ).toHaveLength(1);
      await expect(
        service.command(p, workId, u, {
          ...cmd,
          action: { ...cmd.action, text: "changed" },
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service.command(p, workId, u, { ...cmd, idempotencyKey: randomUUID() }),
      ).rejects.toMatchObject({ code: "revision_conflict" });
      const events = await service.events(p, workId, u, 0);
      expect(new Set(events.map((e) => e.sequence)).size).toBe(events.length);
      expect(
        await service.events(p, workId, u, events.at(-1)!.sequence),
      ).toEqual([]);
    });
    it("applies structured coordinator output through a durable run, then records a draft and immutable delivered artifact", async () => {
      await send({ type: "bind", instanceId, role: "coordinator" });
      // Same version may materialize a second real instance; test data never enters production startup.
      await db.agentRecord.create({
        data: {
          projectId: p,
          id: `${instanceId}-expert`,
          kind: "PROJECT_AGENT",
          developedAgentId: agentId,
          agentVersionId: versionId,
          payload: { status: "READY" },
          ownerUserId: u,
          createdAt: new Date(),
        },
      });
      await send({
        type: "bind",
        instanceId: `${instanceId}-expert`,
        role: "expert",
      });
      const s = await service.snapshot(p, workId, u);
      const messageId = s.messages.at(-1)!.id;
      const card: WorkTask = {
        id: "R-101",
        title: "测试交付",
        status: "todo",
        reason: "测试结构化计划",
        ownerInstanceId: `${instanceId}-expert`,
        dependencies: [],
        acceptance: "核实文本",
        replaces: null,
        sourceMessageId: messageId,
      };
      await send({ type: "plan", sourceMessageId: messageId });
      const adapter = vi.fn(async (_run, beforeTool) => {
        await beforeTool();
        return { reply: "TEST ADAPTER plan", changes: [card] };
      });
      await new WorkWorker(db, adapter).tick();
      const planned = await service.snapshot(p, workId, u);
      expect(planned.state.tasks[0]?.id).toBe("R-101");
      expect(planned.messages.at(-1)?.kind).toBe("agent");
      await send({ type: "execute", taskId: card.id });
      await new WorkWorker(db, async (_run, beforeTool) => {
        await beforeTool();
        return {
          title: "TEST ADAPTER draft",
          content: "Synthetic result, not real model execution",
          evidence: "",
        };
      }).tick();
      const draft = (await service.snapshot(p, workId, u)).state.artifacts[0]!;
      expect(draft.status).toBe("draft");
      expect(draft.runId).toBeTruthy();
      const original = (await service.snapshot(p, workId, u)).state;
      const altered = structuredClone(original);
      altered.tasks[0]!.acceptance = "Changed scope";
      await db.workRecord.update({
        where: { projectId_id: { projectId: p, id: workId } },
        data: { state: workJson(altered) },
      });
      await expect(
        send({ type: "verify", artifactId: draft.id, evidence: "Old scope" }),
      ).rejects.toThrow("任务范围或产物版本已改变");
      await db.workRecord.update({
        where: { projectId_id: { projectId: p, id: workId } },
        data: { state: workJson(original) },
      });
      await expect(
        send({ type: "deliver", artifactId: draft.id }),
      ).rejects.toThrow();
      await send({
        type: "verify",
        artifactId: draft.id,
        evidence: "Synthetic assertions passed",
      });
      await send({ type: "deliver", artifactId: draft.id });
      await expect(
        send({ type: "verify", artifactId: draft.id, evidence: "overwrite" }),
      ).rejects.toThrow();
      expect(
        (await service.snapshot(p, workId, u)).state.tasks[0]?.status,
      ).toBe("done");
    });
    it.each(["expired", "changed", "budget", "cancelled"])(
      "makes zero tool calls for %s authorization",
      async (mode) => {
        await send({
          type: "message",
          text: `New intent ${mode}`,
          source: "text",
        });
        const s = await service.snapshot(p, workId, u);
        await send({ type: "plan", sourceMessageId: s.messages.at(-1)!.id });
        const run = await db.workRunRecord.findFirstOrThrow({
          where: { projectId: p, workId, status: "queued" },
        });
        if (mode === "expired")
          await db.workRunRecord.update({
            where: { id: run.id },
            data: { approvalExpiresAt: new Date(0) },
          });
        if (mode === "changed")
          await db.workRunRecord.update({
            where: { id: run.id },
            data: { input: { changed: true } },
          });
        if (mode === "budget") {
          const state = (await service.snapshot(p, workId, u)).state;
          state.modelCallsUsed = 20;
          await db.workRecord.update({
            where: { projectId_id: { projectId: p, id: workId } },
            data: { state: workJson(state) },
          });
        }
        if (mode === "cancelled") await send({ type: "cancel", runId: run.id });
        const external = vi.fn();
        await new WorkWorker(db, async (_run, gate) => {
          await gate();
          external();
          return {};
        }).tick();
        expect(external).not.toHaveBeenCalled();
        if (mode === "budget") {
          const state = (await service.snapshot(p, workId, u)).state;
          state.modelCallsUsed = 2;
          await db.workRecord.update({
            where: { projectId_id: { projectId: p, id: workId } },
            data: { state: workJson(state) },
          });
        }
      },
    );
    it("fences late results after cancellation and never automatically retries unknown outcomes", async () => {
      await send({
        type: "message",
        text: "Cancellation intent",
        source: "text",
      });
      const s = await service.snapshot(p, workId, u);
      await send({ type: "plan", sourceMessageId: s.messages.at(-1)!.id });
      const run = await db.workRunRecord.findFirstOrThrow({
        where: { projectId: p, workId, status: "queued" },
      });
      const worker = new WorkWorker(db, async (_run, gate) => {
        await gate();
        await send({ type: "cancel", runId: run.id });
        return { reply: "Late result must not appear", changes: [] };
      });
      await worker.tick();
      expect(
        (await service.snapshot(p, workId, u)).messages.some((m) =>
          m.text.includes("Late result"),
        ),
      ).toBe(false);
      expect(
        (await db.workRunRecord.findUniqueOrThrow({ where: { id: run.id } }))
          .status,
      ).toBe("outcome_unknown");
      const adapter = vi.fn();
      await new WorkWorker(db, adapter).tick();
      expect(adapter).not.toHaveBeenCalled();
      await expect(
        send(
          { type: "resolve_unknown", runId: run.id, evidence: "not permitted" },
          v,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await send({
        type: "resolve_unknown",
        runId: run.id,
        evidence: "TEST ONLY gateway usage reconciled; no result delivered",
      });
      expect(
        (await db.workRunRecord.findUniqueOrThrow({ where: { id: run.id } }))
          .status,
      ).toBe("reviewed_unknown");
    });
    it.each([false, true])(
      "records lease expiry and fences stale results; dispatched=%s",
      async (dispatched) => {
        await send({ type: "message", text: "lease recovery", source: "text" });
        const snapshot = await service.snapshot(p, workId, u);
        await send({
          type: "plan",
          sourceMessageId: snapshot.messages.at(-1)!.id,
        });
        const queued = await db.workRunRecord.findFirstOrThrow({
          where: { projectId: p, workId, status: "queued" },
        });
        const run = await db.workRunRecord.update({
          where: { id: queued.id },
          data: { status: "running", fence: 1, leaseUntil: new Date(0) },
        });
        if (dispatched)
          await db.$transaction(async (tx) => {
            const row = await lockWork(tx, p, workId);
            await appendWorkEvent(tx, row, workStateSchema.parse(row.state), {
              key: `tool:${run.id}:1`,
              hash: run.approvedHash,
              type: "model_dispatch",
              summary: "TEST ONLY reservation",
              actorId: instanceId,
            });
          });
        const adapter = vi.fn();
        const worker = new WorkWorker(db, adapter);
        await worker.tick();
        expect(adapter).not.toHaveBeenCalled();
        expect(
          (await db.workRunRecord.findUniqueOrThrow({ where: { id: run.id } }))
            .status,
        ).toBe(dispatched ? "outcome_unknown" : "stopped");
        expect((await service.snapshot(p, workId, u)).events.at(-1)?.type).toBe(
          "run_expired",
        );
        await expect(
          worker.finish(run, { reply: "stale", changes: [] }),
        ).rejects.toMatchObject({ code: "run_fenced" });
        if (dispatched)
          await send({
            type: "resolve_unknown",
            runId: run.id,
            evidence: "TEST ONLY usage checked",
          });
      },
    );
    it("deduplicates simultaneous Work creation", async () => {
      const input = {
        title: "idempotent",
        goal: "creation",
        idempotencyKey: randomUUID(),
      };
      const [one, two] = await Promise.all([
        service.create(p, u, input),
        service.create(p, u, input),
      ]);
      expect(one.id).toBe(two.id);
      await expect(
        service.create(p, u, { ...input, goal: "different" }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("persists a temporary key ledger and blocks exhausted Project budget before inference", async () => {
      const { recordWorkModelKey } = await import("./work-cost-attribution");
      const { productionWorkExecution } = await import("./work-runtime");
      const { CostAnalyticsStore } = await import("../providers/cost-analytics-store");
      const { tokenIdentifier } = await import("../providers/cost-service");
      const { createHash } = await import("node:crypto");
      const run = await db.workRunRecord.findFirstOrThrow({where:{projectId:p,workId,kind:"plan"}});
      const secret = "sk-synthetic-key-never-sent";
      const digest = createHash("sha256").update(secret).digest("hex");
      await recordWorkModelKey(db, run, {secret,tokenId:secret}, "test-team", new Date(0));
      const ledger = new CostAnalyticsStore(db,p);
      const mapping = await ledger.findAttribution({hashedToken:tokenIdentifier(digest)!,at:new Date().toISOString()});
      expect(mapping).toMatchObject({workId,workRunId:run.id,instanceId});
      expect(mapping?.taskId).toBeUndefined();
      expect(JSON.stringify(mapping)).not.toContain(secret);
      expect(await ledger.findAttribution({teamId:"test-team",at:new Date().toISOString()})).toBeUndefined();
      const fact = {
        eventId: `test:${run.id}`, requestId: `test:${run.id}`, requestStartTime: new Date().toISOString(),
        usageDate: new Date().toISOString().slice(0,10), usageHour: 0, projectId:p,
        workId, workRunId:run.id, instanceId, virtualKeyId:tokenIdentifier(digest)!,
        requestedModel:"fixture", resolvedModel:"fixture", modelGroup:"fixture", provider:"fixture", callType:"chat",
        promptTokens:10, completionTokens:5, totalTokens:15, cachedInputTokens:0, cacheCreationInputTokens:0, reasoningTokens:0,
        totalCostUsd:0.25, costStatus:"known" as const, costSource:"test-only", priceVersion:"test",
        requestCount:1 as const, successCount:1 as const, failureCount:0 as const, retryCount:0,
        cacheHit:false, fallbackUsed:false, status:"success", tags:[], metadata:{}, sourceRecordHash:"fixture", createdAt:new Date().toISOString(),
      };
      expect(await ledger.insertFact(fact)).toBe(true);
      await db.modelUsageFactRecord.updateMany({where:{projectId:p,requestId:fact.requestId},data:{workId:null,workRunId:null}});
      expect(await Promise.all([ledger.insertFact(fact),ledger.insertFact(fact)])).toEqual([false,false]);
      const rows = await ledger.listFacts({projectId:p,startTime:"2020-01-01T00:00:00Z",endTime:"2099-01-01T00:00:00Z"});
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({workId,workRunId:run.id,totalCostUsd:0.25,totalTokens:15});
      expect(await db.modelUsageFactObservation.count({where:{projectId:p,reason:"work_attribution_enriched"}})).toBe(1);
      await db.projectQuotaRecord.upsert({where:{projectId:p},create:{projectId:p,hardBudgetUsd:0,budgetDuration:"30d",budgetPeriodStartedAt:new Date(),budgetResetsAt:new Date(Date.now()+86400000),syncStatus:"synced",litellmTeamId:"test-team"},update:{hardBudgetUsd:0,budgetDuration:"30d",budgetPeriodStartedAt:new Date(),budgetResetsAt:new Date(Date.now()+86400000),syncStatus:"synced",litellmTeamId:"test-team"}});
      const dispatch = vi.fn();
      await expect(productionWorkExecution(db)(run,dispatch,new AbortController().signal)).rejects.toMatchObject({code:"budget_unavailable"});
      expect(dispatch).not.toHaveBeenCalled();
    });
  },
);

// No pre-existing assignment is required for the personal entry path.
describe.skipIf(!url)("first-use empty personal Project", () => {
  it("creates only the user's private empty Project under concurrent first entry", async () => {
    const { ensurePersonalProject } =
      await import("../projects/personal-project");
    const db = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: url! },
        { schema: "tasklattice" },
      ),
    });
    const id = `personal-test-${randomUUID()}`;
    await db.user.create({
      data: {
        id,
        email: `${id}@example.invalid`,
        displayName: "First time user",
      },
    });
    const auth = {
      user: {
        id,
        displayName: "First time user",
        email: `${id}@example.invalid`,
        username: id,
        systemRole: "user" as const,
        hasPassword: false,
      },
    };
    try {
      await Promise.all([
        ensurePersonalProject(db, auth),
        ensurePersonalProject(db, auth),
      ]);
      const memberships = await db.projectMember.findMany({
        where: { userId: id },
        include: { project: true },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.role).toBe("user");
      const p = memberships[0]!.project;
      expect(p.createdBy).toBe(id);
      expect(p.name).toBe("我的 Project");
      for (const count of [
        await db.agentRecord.count({ where: { projectId: p.id } }),
        await db.workRecord.count({ where: { projectId: p.id } }),
        await db.providerAccountRecord.count({ where: { projectId: p.id } }),
      ])
        expect(count).toBe(0);
      await db.projectMember.update({
        where: { projectId_userId: { projectId: p.id, userId: id } },
        data: { manualAccess: false, externalAccessActive: false },
      });
      expect(await ensurePersonalProject(db, auth)).toBeNull();
      expect(
        (
          await db.projectMember.findUniqueOrThrow({
            where: { projectId_userId: { projectId: p.id, userId: id } },
          })
        ).manualAccess,
      ).toBe(false);
    } finally {
      const departments = await db.department.findMany({
        where: { createdBy: id },
      });
      await db.project.deleteMany({ where: { createdBy: id } });
      await db.department.deleteMany({
        where: { id: { in: departments.map((d) => d.id) } },
      });
      await db.user.delete({ where: { id } });
      await db.$disconnect();
    }
  });
});
