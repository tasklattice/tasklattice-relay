import { randomUUID } from "node:crypto";
import { personalConnectSchema, personalPrepareSchema, personalSetupStateSchema, createProviderConnectionSchema, createModelRoutingSchema, type PersonalSetupState, type PersonalOnboardingStatus } from "@tali/contracts";
import type { PrismaClient } from "../generated/prisma/client";
import { prisma } from "../db/prisma";
import { lockProjectRow } from "./project-row-lock";
import { ownsPersonalProject, requirePersonalProject } from "./personal-project-access";
import { ProviderService } from "../providers/provider-service";
import { ModelRoutingService } from "../model-routings/model-routing-service";
import { ProjectQuotaService } from "../quotas/project-quota-service";
import { ProjectStore } from "./project-store";
import { DatabaseSecretStore } from "../secrets/database-secret-store";
import { LiteLLMClient } from "../providers/litellm-client";
import { ExpertAgentLifecycleService } from "../expert-agents/expert-agent-lifecycle-service";
import { ExpertAgentTestService } from "../expert-agents/expert-agent-validation-service";
import { buildExpertAgentVersionSnapshot, expertAgentContentDigest } from "../expert-agents/expert-agent-domain";
import { ExpertAgentRuntimeResourceService } from "../runtime-bridge/expert-agent-runtime-resource-service";
import { structuredProjectCompletion } from "../expert-agents/structured-project-completion";
import { personalAgentTemplate } from "../works/personal-agent-template";
import { workModelKeyConfiguration } from "../works/work-model-key";
import { WorkError } from "../works/work-domain";
import { workJson } from "../works/work-service";

const origins: Record<string, string> = { openai: "https://api.openai.com", deepseek: "https://api.deepseek.com", openrouter: "https://openrouter.ai", "nvidia-nim": "https://integrate.api.nvidia.com" };
export function validatePersonalEndpoint(provider: string, endpoint: string) {
  const url = new URL(endpoint);
  const allowed = provider === "custom-openai-compatible"
    ? (process.env.TALI_PERSONAL_PROVIDER_ORIGINS ?? "").split(",").map((v) => v.trim()).filter(Boolean)
    : [origins[provider]];
  if (url.username || url.password || url.search || url.hash || !allowed.includes(url.origin))
    throw new WorkError("此 Provider 地址未获当前部署允许，请检查地址或联系部署维护者。", 400, "provider_endpoint_denied");
}

export class PersonalOnboardingService {
  constructor(readonly db: PrismaClient = prisma()) {}
  async status(projectId: string, userId: string): Promise<PersonalOnboardingStatus> {
    if (!await ownsPersonalProject(this.db, projectId, userId))
      return { eligible: false, revision: 0, status: "EMPTY", busy: false, interrupted: false, error: null, state: {} };
    const row = await this.db.personalOnboardingRecord.findUnique({ where: { projectId } });
    return {
      eligible: true, revision: row?.revision ?? 0,
      status: (row?.status ?? "EMPTY") as PersonalOnboardingStatus["status"],
      busy: Boolean(row?.leaseUntil && row.leaseUntil > new Date()),
      interrupted: Boolean(row?.operationId && (!row.leaseUntil || row.leaseUntil <= new Date())),
      error: row?.error ?? null, state: personalSetupStateSchema.parse(row?.state ?? {}),
    };
  }
  private async claim(projectId: string, userId: string, revision: number, status: string) {
    return this.db.$transaction(async (db) => {
      await requirePersonalProject(db, projectId, userId);
      await lockProjectRow(db, projectId);
      const row = await db.personalOnboardingRecord.upsert({ where: { projectId }, create: { projectId }, update: {} });
      if (row.revision !== revision || (row.leaseUntil && row.leaseUntil > new Date())) throw new WorkError("设置已更新或正在准备，请刷新后继续。", 409, "onboarding_conflict");
      if (row.status === "READY") throw new WorkError("团队已准备完成，无需重复初始化。");
      const operationId = randomUUID();
      await db.personalOnboardingRecord.update({ where: { projectId }, data: { status, operationId, leaseUntil: new Date(Date.now() + 10 * 60000), error: null, revision: { increment: 1 } } });
      return { operationId, state: personalSetupStateSchema.parse(row.state) };
    });
  }
  private async guard(projectId: string, userId: string, operationId: string) {
    await requirePersonalProject(this.db, projectId, userId);
    const row = await this.db.personalOnboardingRecord.findUniqueOrThrow({ where: { projectId } });
    if (row.operationId !== operationId || !row.leaseUntil || row.leaseUntil <= new Date()) throw new WorkError("本次准备已失效，请重新确认后继续。", 409, "onboarding_fenced");
  }
  private async save(projectId: string, userId: string, operationId: string, state: PersonalSetupState, status?: string) {
    await this.guard(projectId, userId, operationId);
    const changed = await this.db.personalOnboardingRecord.updateMany({ where: { projectId, operationId, leaseUntil: { gt: new Date() } }, data: {
      state: workJson(personalSetupStateSchema.parse(state)), revision: { increment: 1 },
      ...(status ? { status, operationId: null, leaseUntil: null } : {}),
    } });
    if (!changed.count) throw new WorkError("准备状态已改变，请刷新。");
  }
  private async fail(projectId: string, operationId: string, message: string) {
    // Provider bodies may echo keys; never persist or return upstream errors.
    await this.db.personalOnboardingRecord.updateMany({ where: { projectId, operationId }, data: { status: "ERROR", error: message, operationId: null, leaseUntil: null, revision: { increment: 1 } } });
  }
  async connect(projectId: string, userId: string, raw: unknown) {
    const input = personalConnectSchema.parse(raw);
    validatePersonalEndpoint(input.provider, input.endpoint);
    const { operationId, state } = await this.claim(projectId, userId, input.expectedRevision, "CONNECTING");
    try {
      if (state.modelDeploymentId) throw new WorkError("模型已连接，请继续准备团队。");
      const provider = new ProviderService(new ProjectStore(projectId, this.db), new LiteLLMClient(), new DatabaseSecretStore(this.db));
      await this.guard(projectId, userId, operationId);
      const result = await provider.createConnection(createProviderConnectionSchema.parse({
        connection: { provider: input.provider, name: "个人模型连接", config: { endpoint: input.endpoint }, credentials: { apiKey: input.apiKey } },
        models: [{ modelId: input.modelId, displayName: input.modelId, modelType: "llm" }], complianceDomain: input.provider === "deepseek" ? "CN_MAINLAND" : "GLOBAL",
      }));
      const model = result.models.find((m) => m.modelId === input.modelId && m.status === "VALIDATED");
      if (!model) throw new WorkError("所选模型未通过连接验证。");
      Object.assign(state, { providerAccountId: result.account.id, modelDeploymentId: model.id, modelId: input.modelId, provider: input.provider, endpoint: input.endpoint, budgetUsd: input.budgetUsd });
      await this.save(projectId, userId, operationId, state, "CONNECTED");
    } catch {
      await this.fail(projectId, operationId, "连接未完成。请检查 API Key、模型名称和模型网关；已发出的连接探测可能计费，再试一次会重新确认连接。");
    }
    return this.status(projectId, userId);
  }
  async prepare(projectId: string, userId: string, raw: unknown) {
    const { expectedRevision } = personalPrepareSchema.parse(raw);
    const { operationId, state } = await this.claim(projectId, userId, expectedRevision, "PREPARING");
    let phase = "模型与预算";
    try {
      if (!state.modelDeploymentId || !state.budgetUsd) throw new WorkError("请先连接模型。");
      const store = new ProjectStore(projectId, this.db), gateway = new LiteLLMClient();
      const model = await store.getModelDeployment(state.modelDeploymentId);
      if (!model || model.status !== "VALIDATED") throw new WorkError("模型不可用，请重新连接。");
      const routingService = new ModelRoutingService(store, gateway);
      // Reuse a persisted routing after an interrupted response; never recreate it blindly.
      let routing = state.routingId ? await routingService.get(state.routingId) : (await routingService.list()).find((r) => r.name === "个人默认模型" && r.routingPolicy.mode === "SINGLE" && r.routingPolicy.modelDeploymentId === model.id);
      if (!routing) {
        await this.guard(projectId, userId, operationId);
        routing = await routingService.create(createModelRoutingSchema.parse({ name: "个人默认模型", description: "个人工作团队共用的默认模型", gatewayId: "litellm-default", complianceDomain: model.complianceDomain, routingPolicy: { mode: "SINGLE", modelDeploymentId: model.id, fallbackModelDeploymentIds: [], retries: 0 }, isDefault: true }), userId);
      }
      state.routingId = routing.id;
      await this.save(projectId, userId, operationId, state);
      if (routing.status !== "READY") routing = await routingService.refresh(routing.id, userId);
      if (routing.status !== "READY") throw new WorkError("模型路由未就绪。");
      const quota = new ProjectQuotaService(store, gateway);
      await this.guard(projectId, userId, operationId);
      const currentQuota = await quota.get();
      if (currentQuota.hardBudgetUsd !== state.budgetUsd || currentQuota.syncStatus !== "synced") {
        const updated = await quota.update({ hardBudgetUsd: state.budgetUsd, budgetDuration: "30d", tpmLimit: null, maxInstances: 2, maxMcpIntegrations: 0, maxKnowledgeBaseIntegrations: 0 }, userId);
        if (updated.syncStatus !== "synced") throw new WorkError("预算未同步。");
      }
      const lifecycle = new ExpertAgentLifecycleService(this.db);
      for (const role of ["coordinator", "expert"] as const) {
        phase = role === "coordinator" ? "协调者" : "工作专家";
        await this.guard(projectId, userId, operationId);
        const agentField = role === "coordinator" ? "coordinatorAgentId" : "expertAgentId";
        const instanceField = role === "coordinator" ? "coordinatorInstanceId" : "expertInstanceId";
        const definition = personalAgentTemplate(role, routing);
        let agent = await this.db.expertAgentRecord.findFirst({ where: { projectId, slug: `personal-work-${role}`, deletedAt: null } });
        if (!agent) agent = await lifecycle.createAgent({ projectId, actorId: userId, slug: `personal-work-${role}`, executionMode: "AGENTIC", definition });
        state[agentField] = agent.id;
        await this.save(projectId, userId, operationId, state);
        const { expectedRevision: _, ...template } = definition;
        const snapshot = buildExpertAgentVersionSnapshot({ agentId: agent.id, definition: template });
        if (expertAgentContentDigest(snapshot) !== agent.contentDigest) throw new WorkError("默认专家已被修改，请保留现有配置并由开发者完成发布。");
        let version = await this.db.expertAgentVersionRecord.findFirst({ where: { projectId, agentId: agent.id, contentDigest: agent.contentDigest } });
        if (!version) {
          let dispatched = false;
          const resource = new ExpertAgentRuntimeResourceService({ projectId, agentId: agent.id, versionId: `onboarding:${operationId}`, contentDigest: agent.contentDigest, namespace: "personal-work-validation", expiresAt: new Date(Date.now() + 120000).toISOString() }, {
            db: this.db, snapshot,
            litellm: {
              callMcpTool: async () => { throw new WorkError("初始化不允许调用外部工具。"); },
              completeStructuredModel: async (request) => {
                await this.guard(projectId, userId, operationId);
                if (dispatched) throw new WorkError("本次验证仅授权一次模型调用。");
                const budget = await quota.get();
                if (budget.syncStatus !== "synced" || budget.hardBudgetUsd === null || budget.usage.spendUsd >= budget.hardBudgetUsd) throw new WorkError("预算不足。");
                const keyConfiguration = await workModelKeyConfiguration(store, routing.id, request.model);
                const { key } = await quota.createInstanceKey({ alias: `onboarding-${operationId}-${role}`, duration: "2m", models: [request.model], ...keyConfiguration, metadata: { tali_project_id: projectId, tali_onboarding_id: operationId, tali_instance_role: role }, objectPermissions: { mcpServers: [] } });
                try {
                  return await structuredProjectCompletion({ baseUrl: await gateway.connectionBaseUrl(), secret: key.secret, model: request.model, messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }], schema: request.responseJsonSchema, schemaName: "work_readiness", maxTokens: 1800, temperature: 0, operation: "personal readiness", allowFormatFallback: false,
                    fetchImplementation: async (url, init) => {
                      await this.guard(projectId, userId, operationId);
                      const latestBudget = await quota.get();
                      if (latestBudget.syncStatus !== "synced" || latestBudget.hardBudgetUsd === null || latestBudget.usage.spendUsd >= latestBudget.hardBudgetUsd) throw new WorkError("预算不可用，未发出调用。");
                      if (dispatched) throw new WorkError("不能重复验证。");
                      dispatched = true;
                      return fetch(url, { ...init, redirect: "error" });
                    },
                  });
                } catch { throw new WorkError("模型未返回有效结构；本次请求可能计费。请确认后重试。"); }
                finally { await gateway.revokeKey(key.tokenId).catch(() => undefined); }
              },
            },
          });
          const test = await new ExpertAgentTestService(projectId, { db: this.db, lifecycle, runtimeResources: {
            completeModel: (input) => resource.completeModel(input),
            callMcpTool: async () => { throw new WorkError("外部工具未授权。"); },
            searchKnowledge: async () => { throw new WorkError("知识库未授权。"); },
          } }).runPublishTest({ agentId: agent.id, actorId: userId });
          if (test.status !== "PASSED") throw new WorkError("默认专家验证未通过。");
          await this.guard(projectId, userId, operationId);
          version = await lifecycle.publishAgent({ projectId, agentId: agent.id, actorId: userId, expectedRevision: agent.revision, publicationNotes: "Personal Work model-only template; live structured-output readiness checked." });
        }
        const instanceId = `personal-work-${role}-${version.id}`;
        await this.guard(projectId, userId, operationId);
        await this.db.agentRecord.upsert({ where: { projectId_id: { projectId, id: instanceId } }, update: {}, create: {
          projectId, id: instanceId, kind: "WORK_AGENT", developedAgentId: agent.id, agentVersionId: version.id, ownerUserId: userId, createdByUserId: userId, createdAt: new Date(),
          payload: { name: snapshot.product.name, status: "READY", runtime: "work-worker", role, versionId: version.id, capability: snapshot.product.purpose },
        } });
        state[instanceField] = instanceId;
        await this.save(projectId, userId, operationId, state);
      }
      await this.save(projectId, userId, operationId, state, "READY");
    } catch {
      await this.fail(projectId, operationId, `${phase}准备未完成。已成功连接的资源会保留；请检查模型网关、预算和发布验证记录后重试。模型验证可能已计费，重试会再次调用模型。`);
    }
    return this.status(projectId, userId);
  }
}
