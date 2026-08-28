import { randomUUID } from "node:crypto";
import {
  complianceDomainCatalog,
  providerPresets,
  providerSupportsComplianceDomain,
  type CreateModelDeploymentInput,
  type CreateProviderConnectionInput,
  type ModelDeployment,
  type ModelRemovalImpact,
  type ModelRouting,
  type ProviderAccount,
  type ProviderConnectionCreationResult,
  type ProviderConnectionDraft,
  type ProviderDiscoveryResult,
  type ProviderKind,
  type ProviderModelSelection,
  type ProviderValidationCheck,
} from "@tali/contracts";
import { ProjectStore } from "../projects/project-store";
import {
  classifyModelMetadata,
  providerAdapter,
} from "./provider-adapters";
import { LiteLLMClient, type LiteLLMAdminClient } from "./litellm-client";
import { PlatformSettingsService } from "../platform/platform-settings-service";

interface StoredProviderCredential {
  version: 1;
  provider: ProviderKind;
  skipTlsVerify?: boolean;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

const validationChecks = (
  discovery: ProviderDiscoveryResult,
  hasFailures: boolean,
): ProviderValidationCheck[] => [
  { id: "endpoint", label: "Endpoint reachability", status: "PASS" },
  { id: "credentials", label: "Credential authorization", status: "PASS" },
  {
    id: "catalog",
    label: discovery.mode === "remote" ? "Model catalog discovery" : "Manual or curated model catalog",
    status: discovery.mode === "remote" ? "PASS" : "SKIP",
  },
  { id: "inference", label: "LiteLLM model capability probe", status: hasFailures ? "FAIL" : "PASS" },
];

const modelChecks = (status: "PASS" | "FAIL"): ProviderValidationCheck[] => [
  { id: "endpoint", label: "Endpoint reachability", status },
  { id: "credentials", label: "Credential authorization", status },
  { id: "catalog", label: "Model registration", status },
  { id: "inference", label: "LiteLLM model capability probe", status },
];

function catalog(kind: ProviderKind) {
  const item = providerPresets.find((candidate) => candidate.id === kind);
  if (!item) throw new Error(`Provider catalog entry ${kind} was not found.`);
  return item;
}

function endpointHostname(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "";
  }
}

function awsRegionMatchesBoundary(
  region: string,
  domain: CreateProviderConnectionInput["complianceDomain"],
): boolean {
  if (domain === "GLOBAL") return true;
  if (domain === "US") return region.startsWith("us-");
  if (domain === "UK") return region === "eu-west-2";
  if (domain === "EU_EEA") {
    return region.startsWith("eu-") && region !== "eu-west-2";
  }
  if (domain === "APAC_EX_CN") return region.startsWith("ap-");
  return false;
}

function vertexLocationMatchesBoundary(
  location: string,
  domain: CreateProviderConnectionInput["complianceDomain"],
): boolean {
  if (domain === "GLOBAL") return true;
  if (domain === "US") return location.startsWith("us-");
  if (domain === "UK") return location === "europe-west2";
  if (domain === "EU_EEA") {
    return location.startsWith("europe-") && location !== "europe-west2";
  }
  if (domain === "APAC_EX_CN") {
    return location.startsWith("asia-") || location.startsWith("australia-");
  }
  return false;
}

function assertComplianceConfiguration(
  input: CreateProviderConnectionInput,
): void {
  const provider = catalog(input.connection.provider);
  const boundary = complianceDomainCatalog.find(
    (candidate) => candidate.id === input.complianceDomain,
  );
  if (!providerSupportsComplianceDomain(provider.id, input.complianceDomain)) {
    throw new Error(
      `${provider.name} does not have a supported endpoint configuration for ${boundary?.label ?? input.complianceDomain}.`,
    );
  }
  if (
    input.connection.provider === "qwen"
    && ((input.complianceDomain === "CN_MAINLAND"
      && (input.connection.config.region !== "cn"
        || endpointHostname(input.connection.config.endpoint)
          !== "dashscope.aliyuncs.com"))
      || (input.complianceDomain !== "CN_MAINLAND"
        && (input.connection.config.region !== "international"
          || endpointHostname(input.connection.config.endpoint)
            !== "dashscope-intl.aliyuncs.com")))
  ) {
    throw new Error(
      `Qwen endpoint region does not match the ${boundary?.label ?? input.complianceDomain} boundary.`,
    );
  }
  if (
    input.connection.provider === "moonshot"
    && ((input.complianceDomain === "CN_MAINLAND"
      && (input.connection.config.region !== "cn"
        || endpointHostname(input.connection.config.endpoint)
          !== "api.moonshot.cn"))
      || (input.complianceDomain !== "CN_MAINLAND"
        && (input.connection.config.region !== "global"
          || endpointHostname(input.connection.config.endpoint)
            !== "api.moonshot.ai")))
  ) {
    throw new Error(
      `Moonshot endpoint region does not match the ${boundary?.label ?? input.complianceDomain} boundary.`,
    );
  }
  if (
    input.connection.provider === "aws-bedrock"
    && !awsRegionMatchesBoundary(
      input.connection.config.region,
      input.complianceDomain,
    )
  ) {
    throw new Error(
      `AWS Bedrock region does not match the ${boundary?.label ?? input.complianceDomain} boundary.`,
    );
  }
  if (
    input.connection.provider === "vertex-ai"
    && !vertexLocationMatchesBoundary(
      input.connection.config.location,
      input.complianceDomain,
    )
  ) {
    throw new Error(
      `Vertex AI location does not match the ${boundary?.label ?? input.complianceDomain} boundary.`,
    );
  }
}

function encodeCredential(draft: ProviderConnectionDraft): string {
  return JSON.stringify({
    version: 1,
    provider: draft.provider,
    ...(draft.skipTlsVerify !== undefined
      ? { skipTlsVerify: draft.skipTlsVerify }
      : {}),
    config: draft.config,
    credentials: draft.credentials,
  } satisfies StoredProviderCredential);
}

function decodeCredential(account: ProviderAccount, rawCredential: string): ProviderConnectionDraft {
  const stored = JSON.parse(rawCredential) as Partial<StoredProviderCredential>;
  if (
    stored.version !== 1 ||
    !stored.provider ||
    !stored.config ||
    !stored.credentials
  )
    throw new Error("Stored Provider credential data is invalid.");
  return {
    provider: stored.provider,
    name: account.name,
    ...(stored.skipTlsVerify !== undefined
      ? { skipTlsVerify: stored.skipTlsVerify }
      : {}),
    config: stored.config,
    credentials: stored.credentials,
  } as ProviderConnectionDraft;
}

type NormalizedModelSelection = ProviderModelSelection & {
  capabilities: NonNullable<ProviderModelSelection["capabilities"]>;
  inputModalities: NonNullable<ProviderModelSelection["inputModalities"]>;
  outputModalities: NonNullable<ProviderModelSelection["outputModalities"]>;
};

function toModelSelection(input: CreateModelDeploymentInput): NormalizedModelSelection {
  const { providerAccountId: _providerAccountId, ...model } = input;
  return normalizeModelSelection(model);
}

function normalizeModelSelection(
  model: ProviderModelSelection,
): NormalizedModelSelection {
  const inferred = classifyModelMetadata(model.modelId, model.modelType);
  return {
    ...model,
    capabilities: model.capabilities ?? inferred.capabilities,
    inputModalities: model.inputModalities ?? inferred.inputModalities,
    outputModalities: model.outputModalities ?? inferred.outputModalities,
  };
}

function routingUsesAnyModel(
  routing: ModelRouting,
  deploymentIds: ReadonlySet<string>,
): boolean {
  const policy = routing.routingPolicy;
  if (policy.mode === "SINGLE") {
    return deploymentIds.has(policy.modelDeploymentId)
      || policy.fallbackModelDeploymentIds.some((id) => deploymentIds.has(id));
  }
  if (policy.mode === "COMPLEXITY") {
    return deploymentIds.has(policy.simpleModelDeploymentId)
      || deploymentIds.has(policy.complexModelDeploymentId)
      || policy.fallbackModelDeploymentIds.some((id) => deploymentIds.has(id));
  }
  return deploymentIds.has(policy.defaultModelDeploymentId)
    || deploymentIds.has(policy.embeddingModelDeploymentId)
    || policy.routes.some((route) =>
      deploymentIds.has(route.modelDeploymentId)
    )
    || policy.fallbackModelDeploymentIds.some((id) => deploymentIds.has(id));
}

export class ProviderService {
  constructor(
    readonly store = new ProjectStore(),
    readonly litellm: LiteLLMAdminClient = new LiteLLMClient(),
  ) {}

  async listAccounts(): Promise<ProviderAccount[]> {
    return this.store.listProviderAccounts();
  }

  async listModels(providerAccountId?: string): Promise<ModelDeployment[]> {
    return this.store.listModelDeployments(providerAccountId);
  }

  discover(draft: ProviderConnectionDraft): Promise<ProviderDiscoveryResult> {
    return providerAdapter(draft.provider).discover(draft);
  }

  async discoverAccount(id: string): Promise<ProviderDiscoveryResult | undefined> {
    const account = await this.store.getProviderAccount(id);
    const rawCredential = await this.store.getProviderAccountCredential(id);
    if (!account || !rawCredential) return undefined;
    return this.discover(decodeCredential(account, rawCredential));
  }

  async createConnection(input: CreateProviderConnectionInput): Promise<ProviderConnectionCreationResult> {
    await new PlatformSettingsService(this.store.database())
      .assertProviderEnabled(input.connection.provider);
    assertComplianceConfiguration(input);
    const discovery = await this.discover(input.connection);
    return this.createConnectionWithDiscovery(input, discovery);
  }

  async revalidateAccount(id: string): Promise<ProviderAccount | undefined> {
    const account = await this.store.getProviderAccount(id);
    const rawCredential = await this.store.getProviderAccountCredential(id);
    if (!account || !rawCredential) return undefined;
    const draft = decodeCredential(account, rawCredential);
    const discovery = await this.discover(draft);
    const models = await this.store.listModelDeployments(id);
    let passed = 0;
    for (const model of models) {
      try {
        await this.litellm.probeModel(model.litellmModelName, model.modelType);
        passed += 1;
        await this.store.saveModelDeployment({
          ...model,
          status: "VALIDATED",
          checks: modelChecks("PASS"),
          validationMessage: `${model.modelId} passed the LiteLLM capability probe.`,
          validatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        await this.store.saveModelDeployment({
          ...model,
          status: "FAILED",
          checks: modelChecks("FAIL"),
          validationMessage: error instanceof Error ? error.message : "Model validation failed.",
          updatedAt: new Date().toISOString(),
        });
      }
    }
    const status = models.length === 0
      ? discovery.checks.some((check) => check.status === "FAIL") ? "FAILED" : "VALIDATED"
      : passed === models.length ? "VALIDATED" : passed > 0 ? "DEGRADED" : "FAILED";
    const updated = {
      ...account,
      providerKind: draft.provider,
      config: draft.config,
      endpoint: providerAdapter(draft.provider).endpoint(draft),
      discoveredModels: [...new Set([
        ...discovery.models.map((model) => model.modelId),
        ...models.map((model) => model.modelId),
      ])],
      status,
      checks: validationChecks(discovery, status !== "VALIDATED"),
      validationMessage: models.length
        ? `${passed} of ${models.length} registered models passed revalidation.`
        : discovery.message,
      ...(discovery.latencyMs !== undefined ? { validationLatencyMs: discovery.latencyMs } : {}),
      ...(passed > 0 || models.length === 0
        ? { validatedAt: new Date().toISOString() }
        : account.validatedAt ? { validatedAt: account.validatedAt } : {}),
      updatedAt: new Date().toISOString(),
    } satisfies ProviderAccount;
    return this.store.saveProviderAccount(updated);
  }

  async deleteAccount(id: string): Promise<boolean> {
    const account = await this.store.getProviderAccount(id);
    if (!account) return false;
    const models = await this.store.listModelDeployments(id);
    await this.store.assertCanRemoveEmbeddingModels(
      models.map((model) => model.id),
      `${account.name}'s embedding model`,
    );
    const agentIds = await this.store.listAgentIdsUsingModelDeployments(models.map((model) => model.id));
    if (agentIds.length)
      throw new Error(
        `Delete the ${agentIds.length} Instance${agentIds.length === 1 ? "" : "s"} using this Provider before deleting the Provider.`,
      );
    const deploymentIds = new Set(models.map((model) => model.id));
    const routings = (await this.store.listModelRoutings()).filter((routing) =>
      routingUsesAnyModel(routing, deploymentIds)
    );
    if (routings.length)
      throw new Error(
        `Reconfigure the ${routings.length} Model Routing${routings.length === 1 ? "" : "s"} using this Provider before deleting the Provider.`,
      );
    for (const model of models)
      await this.litellm.deleteModel(model.litellmModelName).catch(() => undefined);
    return this.store.deleteProviderAccount(id);
  }

  async deleteModelDeployment(id: string): Promise<boolean> {
    const model = await this.store.getModelDeployment(id);
    if (!model) return false;
    await this.store.assertCanRemoveEmbeddingModels([id], model.displayName);
    const agentIds = await this.store.listAgentIdsUsingModelDeployments([id]);
    if (agentIds.length) {
      throw new Error(
        `${model.displayName} is in use by ${agentIds.length} Instance${
          agentIds.length === 1 ? "" : "s"
        }. Reassign them before removing the model.`,
      );
    }
    const routings = (await this.store.listModelRoutings()).filter((routing) =>
      routingUsesAnyModel(routing, new Set([id]))
    );
    if (routings.length) {
      throw new Error(
        `${model.displayName} is in use by ${routings.length} Model Routing${
          routings.length === 1 ? "" : "s"
        }. Reconfigure them before removing the model.`,
      );
    }
    await this.litellm.deleteModel(model.litellmModelName).catch(() => undefined);
    return this.store.deleteModelDeployment(id);
  }

  async modelRemovalImpact(id: string): Promise<ModelRemovalImpact | undefined> {
    const model = await this.store.getModelDeployment(id);
    if (!model) return undefined;
    const [agentIds, routings, embeddingImpact] = await Promise.all([
      this.store.listAgentIdsUsingModelDeployments([id]),
      this.store.listModelRoutings().then((items) => items.filter((routing) =>
        routingUsesAnyModel(routing, new Set([id])))),
      this.store.embeddingModelRemovalImpact([id]),
    ]);
    const departmentScope = this.store.projectId.startsWith("department:");
    const dependencies: ModelRemovalImpact["dependencies"] = [
      ...agentIds.map((dependencyId) => ({
        direct: true,
        id: dependencyId,
        kind: departmentScope ? "PROJECT" as const : "INSTANCE" as const,
        name: dependencyId,
      })),
      ...routings.map((routing) => ({
        direct: true,
        id: routing.id,
        kind: "MODEL_ROUTING" as const,
        name: routing.name,
      })),
      ...embeddingImpact.dependencies,
    ];
    const uniqueDependencies = new Map(
      dependencies.map((dependency) => [
        `${dependency.kind}:${dependency.id}`,
        dependency,
      ]),
    );
    return {
      blocking: uniqueDependencies.size > 0,
      dependencies: [...uniqueDependencies.values()],
      modelId: model.id,
      modelName: model.displayName,
      remainingValidatedEmbeddingModels:
        embeddingImpact.remainingValidatedEmbeddingModels,
    };
  }

  async registerModel(input: CreateModelDeploymentInput): Promise<ModelDeployment> {
    const account = await this.store.getProviderAccount(input.providerAccountId);
    const rawCredential = await this.store.getProviderAccountCredential(input.providerAccountId);
    if (!account || !rawCredential) throw new Error("Provider was not found.");
    const draft = decodeCredential(account, rawCredential);
    const supportedTypes = catalog(draft.provider).modelTypes as readonly string[];
    if (!supportedTypes.includes(input.modelType))
      throw new Error(`${catalog(draft.provider).name} does not support ${input.modelType} registrations.`);
    const model = toModelSelection(input);
    try {
      const deployment = await this.registerDraftModel(account, draft, model);
      return this.store.saveModelDeployment(deployment);
    } catch (error) {
      const now = new Date().toISOString();
      return this.store.saveModelDeployment({
        id: randomUUID(),
        providerAccountId: input.providerAccountId,
        ...model,
        providerPresetId: account.presetId,
        providerName: catalog(draft.provider).name,
        endpoint: providerAdapter(draft.provider).endpoint(draft),
        complianceDomain: account.complianceDomain,
        endpointRegion: account.endpointRegion,
        crossBorderTransfer: false,
        litellmModelName: `pending/${account.id}/${input.modelId}`,
        status: "FAILED",
        checks: modelChecks("FAIL"),
        validationMessage: error instanceof Error ? error.message : "Model validation failed.",
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  private async createConnectionWithDiscovery(
    input: CreateProviderConnectionInput,
    discovery: ProviderDiscoveryResult,
  ): Promise<ProviderConnectionCreationResult> {
    const now = new Date().toISOString();
    const adapter = providerAdapter(input.connection.provider);
    const item = catalog(input.connection.provider);
    const account: ProviderAccount = {
      id: randomUUID(),
      name: input.connection.name,
      providerKind: input.connection.provider,
      presetId: input.connection.provider,
      endpoint: adapter.endpoint(input.connection),
      skipTlsVerify: input.connection.skipTlsVerify === true,
      config: input.connection.config,
      complianceDomain: input.complianceDomain,
      endpointRegion:
        complianceDomainCatalog.find(
          (domain) => domain.id === input.complianceDomain,
        )?.endpointRegion ?? "global",
      crossBorderTransfer: false,
      discoveredModels: [...new Set([
        ...discovery.models.map((model) => model.modelId),
        ...input.models.map((model) => model.modelId),
      ])],
      status: "FAILED",
      checks: discovery.checks,
      credentialState: "STORED",
      validationMessage: "Model validation has not completed.",
      ...(discovery.latencyMs !== undefined ? { validationLatencyMs: discovery.latencyMs } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const models: ModelDeployment[] = [];
    const failures: ProviderConnectionCreationResult["failures"] = [];
    for (const rawModel of input.models) {
      const model = normalizeModelSelection(rawModel);
      if (!(item.modelTypes as readonly string[]).includes(model.modelType)) {
        failures.push({ model, message: `${item.name} does not support ${model.modelType} registrations.` });
        continue;
      }
      try {
        models.push(await this.registerDraftModel(account, input.connection, model));
      } catch (error) {
        failures.push({
          model,
          message: error instanceof Error ? error.message : "Model registration failed.",
        });
      }
    }
    if (!models.length)
      throw new Error(
        failures[0]?.message ?? "No selected model could be registered through LiteLLM.",
      );
    const validatedAt = new Date().toISOString();
    const savedAccount = await this.store.saveProviderAccount({
      ...account,
      status: failures.length ? "DEGRADED" : "VALIDATED",
      checks: validationChecks(discovery, failures.length > 0),
      validationMessage: failures.length
        ? `${models.length} models registered; ${failures.length} need attention.`
        : `${models.length} models registered and validated through LiteLLM.`,
      validatedAt,
      updatedAt: validatedAt,
    }, encodeCredential(input.connection));
    for (const model of models) await this.store.saveModelDeployment(model);
    return { account: savedAccount, models, failures };
  }

  private async registerDraftModel(
    account: ProviderAccount,
    draft: ProviderConnectionDraft,
    rawModel: ProviderModelSelection,
  ): Promise<ModelDeployment> {
    const model = normalizeModelSelection(rawModel);
    const adapter = providerAdapter(draft.provider);
    let litellmModelName: string | undefined;
    try {
      litellmModelName = await this.litellm.registerModel({
        accountId: account.id,
        providerKind: draft.provider,
        model,
        litellmParams: {
          ...adapter.toLiteLLMParams(draft, model),
          ...(draft.skipTlsVerify ? { ssl_verify: false } : {}),
        },
        complianceDomain: account.complianceDomain,
        endpointRegion: account.endpointRegion,
      });
      await this.litellm.probeModel(litellmModelName, model.modelType);
      const now = new Date().toISOString();
      return {
        id: randomUUID(),
        providerAccountId: account.id,
        ...model,
        providerPresetId: account.presetId,
        providerName: catalog(draft.provider).name,
        endpoint: adapter.endpoint(draft),
        complianceDomain: account.complianceDomain,
        endpointRegion: account.endpointRegion,
        crossBorderTransfer: false,
        litellmModelName,
        status: "VALIDATED",
        checks: modelChecks("PASS"),
        validationMessage: `${model.modelId} is registered and responding through LiteLLM.`,
        validatedAt: now,
        createdAt: now,
        updatedAt: now,
      };
    } catch (error) {
      if (litellmModelName)
        await this.litellm.deleteModel(litellmModelName).catch(() => undefined);
      throw error;
    }
  }
}
