import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { PrismaClient } from "../generated/prisma/client";
import { ensurePersonalProject } from "./personal-project";
import { PersonalOnboardingService } from "./personal-onboarding-service";
import { LiteLLMClient } from "../providers/litellm-client";
import { DatabaseSecretStore } from "../secrets/database-secret-store";
import { ProjectStore } from "./project-store";
import { WorkService } from "../works/work-service";
import { WorkWorker } from "../works/work-worker";
import type { PlatformPrincipal } from "../auth/auth";

const url = process.env.WORK_TEST_DATABASE_URL;
describe.skipIf(!url)("personal onboarding on PostgreSQL — TEST ONLY gateway adapter", () => {
  let db: PrismaClient, projectId: string, departmentId: string, setup: PersonalOnboardingService;
  const userId = `onboarding-test-${randomUUID()}`, otherId = `onboarding-other-${randomUUID()}`;
  let calls = 0;
  let failExpert = true;
  beforeAll(async () => {
    if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname) || !new URL(url).pathname.includes("relay_work")) throw new Error("Requires isolated local relay_work database");
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema: "tasklattice" }) });
    for (const id of [userId, otherId]) await db.user.create({ data: { id, email: `${id}@example.invalid`, displayName: "TEST ONLY", systemRole: "user" } });
    projectId = (await ensurePersonalProject(db, { user: { id: userId, systemRole: "user" } } as PlatformPrincipal))!;
    departmentId = (await db.project.findUniqueOrThrow({ where: { id: projectId } })).departmentId;
    setup = new PersonalOnboardingService(db);
    vi.spyOn(LiteLLMClient.prototype, "connectionBaseUrl").mockResolvedValue("https://gateway.test/v1");
    vi.spyOn(LiteLLMClient.prototype, "registerModel").mockImplementation(async ({ registrationId }) => `test-model-${registrationId}`);
    vi.spyOn(LiteLLMClient.prototype, "probeModel").mockResolvedValue();
    vi.spyOn(LiteLLMClient.prototype, "reconcileModelRoutingRoute").mockResolvedValue();
    vi.spyOn(LiteLLMClient.prototype, "inspectModelRouting").mockResolvedValue({
      exists: true, modelCount: 1, complianceDomains: ["GLOBAL"], complianceUnknown: false, configurationHash: "test-only-hash", capabilities: { automaticRouting: "DISABLED", routerType: "OTHER", sessionAffinity: "DISABLED", adaptiveRouting: "DISABLED", failover: "DISABLED", generalFallback: "DISABLED", contextWindowFallback: "DISABLED", contentPolicyFallback: "DISABLED", retries: "DISABLED", requestAudit: "ENABLED" },
    });
    vi.spyOn(LiteLLMClient.prototype, "ensureProjectTeam").mockResolvedValue(`test-team-${userId}`);
    vi.spyOn(LiteLLMClient.prototype, "updateProjectTeam").mockResolvedValue();
    vi.spyOn(LiteLLMClient.prototype, "createInstanceServiceAccountKey").mockResolvedValue({ secret: "TEST ONLY key", tokenId: "TEST ONLY token" });
    vi.spyOn(LiteLLMClient.prototype, "revokeKey").mockResolvedValue();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const address = String(input);
      if (address === "https://api.openai.com/v1/models") return new Response(JSON.stringify({ data: [{ id: "test-only-model" }] }));
      if (address !== "https://gateway.test/v1/chat/completions") throw new Error("Test forbids external network");
      calls++;
      const body = JSON.parse(String(init?.body));
      const plan = Boolean(body.response_format.json_schema.schema.properties.reply);
      if (!plan && failExpert) {
        failExpert = false;
        return new Response("TEST ONLY private upstream body", { status: 503 });
      }
      const context = JSON.parse(body.messages[1].content);
      const result = plan ? { reply: "TEST ONLY: 已分配一项文本任务。", changes: [{ id: "R-1", title: "TEST ONLY 行动清单", status: "todo", reason: "用户请求", ownerInstanceId: context.agents.find((a: { role: string }) => a.role === "expert").instanceId, dependencies: [], acceptance: "三点建议", replaces: null, sourceMessageId: context.sourceMessageId ?? "onboarding-check" }] }
        : { title: "TEST ONLY 草稿", content: "1. 简化首屏。2. 提供默认团队。3. 保留微调入口。", evidence: "TEST ONLY adapter; no real Provider called." };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
    }));
  });
  afterAll(async () => {
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    if (projectId) {
      await db.providerRegistrationReceipt.deleteMany({ where: { scope: projectId } });
      await db.agentRecord.deleteMany({ where: { projectId } });
      await db.expertAgentRecord.updateMany({ where: { projectId }, data: { latestReleasedVersionId: null } });
      await db.expertAgentRecord.deleteMany({ where: { projectId } });
      await db.project.delete({ where: { id: projectId } });
      await db.department.delete({ where: { id: departmentId } });
    }
    await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await db.$disconnect();
  });
  it("rejects another user before any provider call, persists encrypted credentials across clients", async () => {
    const input = { expectedRevision: 0, provider: "openai", endpoint: "https://api.openai.com/v1", apiKey: "test-only-private-credential", modelId: "test-only-model", budgetUsd: 1 };
    expect((await setup.status(projectId, otherId)).eligible).toBe(false);
    await expect(setup.connect(projectId, otherId, input)).rejects.toMatchObject({ status: 403 });
    expect(LiteLLMClient.prototype.registerModel).not.toHaveBeenCalled();
    const results = await Promise.allSettled([setup.connect(projectId, userId, input), setup.connect(projectId, userId, input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const result = await setup.status(projectId, userId);
    expect(result.status, JSON.stringify(result)).toBe("CONNECTED");
    expect(JSON.stringify(result)).not.toContain(input.apiKey);
    const secret = await db.managedSecretRecord.findFirstOrThrow({ where: { projectId } });
    expect(secret.ciphertext).not.toContain(input.apiKey);
    const store = new ProjectStore(projectId, db);
    const reference = await store.getProviderAccountCredential(result.state.providerAccountId!);
    expect(await new DatabaseSecretStore(db).get(reference!)).toContain(input.apiKey);
    const tampered = new DatabaseSecretStore(db, () => "wrong-key-".repeat(4));
    await expect(tampered.get(reference!)).rejects.toThrow();
  });
  it("preserves a prepared coordinator after expert failure, sanitizes errors, and waits for explicit retry", async () => {
    const before = await setup.status(projectId, userId);
    const result = await setup.prepare(projectId, userId, { expectedRevision: before.revision });
    expect(result.status).toBe("ERROR");
    expect(result.state.coordinatorInstanceId).toBeTruthy();
    expect(result.state.expertInstanceId).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("private upstream body");
    expect(calls).toBe(2);
    await setup.status(projectId, userId);
    expect(calls).toBe(2);
    await expect(setup.prepare(projectId, userId, { expectedRevision: before.revision })).rejects.toMatchObject({ status: 409 });
  });
  it("resumes actual release gates with TEST ONLY inference, publishes two roles and auto-binds a new Work", async () => {
    const before = await setup.status(projectId, userId);
    const instances = vi.spyOn(db.agentRecord, "upsert");
    const result = await setup.prepare(projectId, userId, { expectedRevision: before.revision });
    const instanceResults = await Promise.allSettled(instances.mock.results.map((r) => r.value));
    expect(instanceResults.filter((r) => r.status === "rejected")).toEqual([]);
    const reports = await db.expertAgentTestRunRecord.findMany({ where: { projectId }, select: { evidence: true } });
    expect(result.status, JSON.stringify({ result, reports })).toBe("READY");
    expect(calls).toBe(3);
    expect(await db.agentRecord.count({ where: { projectId, kind: "WORK_AGENT" } })).toBe(2);
    expect(reports).toHaveLength(3);
    const service = new WorkService(db), key = randomUUID();
    const input = { title: "TEST ONLY onboarding task", goal: "根据已有材料整理三点建议。", idempotencyKey: key, startPlanning: true };
    const work = await service.create(projectId, userId, input);
    await service.create(projectId, userId, input);
    expect((await service.snapshot(projectId, work.id, userId)).state.agents).toHaveLength(2);
    expect(await db.workRunRecord.count({ where: { projectId, workId: work.id } })).toBe(1);
    expect(await db.workMessageRecord.count({ where: { projectId, workId: work.id } })).toBe(1);
    const worker = new WorkWorker(db);
    await worker.tick();
    let snapshot = await service.snapshot(projectId, work.id, userId);
    expect(snapshot.state.tasks, JSON.stringify(snapshot.runs)).toHaveLength(1);
    snapshot = await service.command(projectId, work.id, userId, { expectedRevision: snapshot.revision, idempotencyKey: randomUUID(), action: { type: "execute", taskId: "R-1" } });
    await worker.tick();
    snapshot = await service.snapshot(projectId, work.id, userId);
    expect(snapshot.state.artifacts, JSON.stringify(snapshot.runs)).toHaveLength(1);
    const artifactId = snapshot.state.artifacts[0]!.id;
    snapshot = await service.command(projectId, work.id, userId, { expectedRevision: snapshot.revision, idempotencyKey: randomUUID(), action: { type: "verify", artifactId, evidence: "TEST ONLY: checked three suggestions against test task." } });
    snapshot = await service.command(projectId, work.id, userId, { expectedRevision: snapshot.revision, idempotencyKey: randomUUID(), action: { type: "deliver", artifactId } });
    expect(snapshot.state.tasks[0]?.status).toBe("done");
    expect(calls).toBe(5);
    const routing = await new ProjectStore(projectId, db).getModelRouting(result.state.routingId!);
    const model = await new ProjectStore(projectId, db).getModelDeployment(result.state.modelDeploymentId!);
    for (const [request] of vi.mocked(LiteLLMClient.prototype.createInstanceServiceAccountKey).mock.calls) {
      expect(request.models).toEqual([routing!.publicModelAlias]);
      expect(request.aliases).toEqual({ [routing!.publicModelAlias]: model!.litellmModelName });
      expect(request.routerSettings).toEqual({ num_retries: 0, fallbacks: [] });
    }
    await expect(setup.prepare(projectId, userId, { expectedRevision: result.revision })).rejects.toThrow();
    expect(calls).toBe(5);
  });
});
