#!/usr/bin/env node

import { RelayClient } from "./live-hermes-e2e-lib.mjs";

const baseUrl = process.env.TALI_BASE_URL ?? "http://127.0.0.1:18080";
const projectId = process.env.TALI_LIVE_EXPERT_AGENT_PROJECT_ID ?? "proj1";
const username = process.env.TALI_VALIDATION_USERNAME ?? "admin";
const password = process.env.TALI_VALIDATION_PASSWORD ?? "password";
const providerName = "Release 0 DeepSeek";
const routingName = "Expert Agent Release 0";
const embeddingProviderName = "Release 0 NVIDIA Embeddings";
const embeddingModelId = "nvidia/llama-nemotron-embed-vl-1b-v2";

if (process.env.TALI_LIVE_MODEL_PROVISIONING !== "1") {
  throw new Error(
    "Set TALI_LIVE_MODEL_PROVISIONING=1 to authorize one bounded Project Provider, model, Routing, and Contract-draft validation.",
  );
}

const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
if (!apiKey) {
  throw new Error("DEEPSEEK_API_KEY is unavailable; no credential was read or persisted.");
}
const embeddingApiKey = process.env.NVAPI_API_KEY?.trim();
if (!embeddingApiKey) {
  throw new Error("NVAPI_API_KEY is unavailable; no credential was read or persisted.");
}

function data(value) {
  return Array.isArray(value) ? value : value?.data ?? [];
}

async function main() {
  const client = new RelayClient(baseUrl);
  await client.login(username, password);

  const accessContext = await client.request("/api/v1/access-context");
  const projectAdmin = accessContext.options.find((option) =>
    option.level === "project"
    && option.resourceId === projectId
    && option.roleId === "ROLE_PROJECT_ADMIN"
  );
  const projectDeveloper = accessContext.options.find((option) =>
    option.level === "project"
    && option.resourceId === projectId
    && option.roleId === "ROLE_AGENT_DEVELOPER"
  );
  if (!projectAdmin || !projectDeveloper) {
    throw new Error(
      "The validation Account must be assigned both Project Administrator and Agent Developer for bounded provisioning.",
    );
  }
  await client.request("/api/v1/access-context", {
    method: "PUT",
    body: JSON.stringify({
      level: projectAdmin.level,
      resourceId: projectAdmin.resourceId,
      roleId: projectAdmin.roleId,
    }),
  });

  try {

    let providers = data(await client.project(projectId, "/providers"));
    let provider = providers.find((item) =>
      item.name === providerName && item.providerKind === "deepseek"
    );
    let models = data(await client.project(projectId, "/models"));

    if (!provider) {
      const connection = {
        provider: "deepseek",
        name: providerName,
        config: { endpoint: "https://api.deepseek.com/v1" },
        credentials: { apiKey },
      };
      const discovery = await client.project(projectId, "/providers/discover", {
        method: "POST",
        body: JSON.stringify(connection),
      });
      const selected = discovery.models.find((model) => model.modelId === "deepseek-chat")
        ?? discovery.models.find((model) => model.modelType === "llm");
      if (!selected) throw new Error("DeepSeek did not expose an LLM deployment.");

      const created = await client.project(projectId, "/providers", {
        method: "POST",
        body: JSON.stringify({
          connection,
          models: [{
            modelId: selected.modelId,
            displayName: selected.displayName,
            modelType: selected.modelType,
            capabilities: selected.capabilities,
            inputModalities: selected.inputModalities,
            outputModalities: selected.outputModalities,
          }],
          complianceDomain: "GLOBAL",
        }),
      });
      provider = created.account;
      models = [...models, ...created.models];
    } else if (provider.status !== "VALIDATED") {
      provider = await client.project(
        projectId,
        `/providers/${encodeURIComponent(provider.id)}/validate`,
        { method: "POST", body: "{}" },
      );
      models = data(await client.project(projectId, "/models"));
    }

    let model = models.find((item) =>
      item.providerAccountId === provider.id
      && item.modelId === "deepseek-chat"
      && item.status === "VALIDATED"
    ) ?? models.find((item) =>
      item.providerAccountId === provider.id
      && item.modelType === "llm"
      && item.status === "VALIDATED"
    );
    if (!model) {
      model = await client.project(projectId, "/models", {
        method: "POST",
        body: JSON.stringify({
          providerAccountId: provider.id,
          modelId: "deepseek-chat",
          displayName: "DeepSeek Chat",
          modelType: "llm",
        }),
      });
    }
    if (model.status !== "VALIDATED") {
      throw new Error(`The selected model is ${model.status}; Routing was not created.`);
    }

    const gateways = data(await client.project(projectId, "/inference-gateways"));
    const gateway = gateways[0];
    if (!gateway) throw new Error("No Project LiteLLM Gateway is available.");

    let routings = data(await client.project(projectId, "/model-routings"));
    let routing = routings.find((item) => item.name === routingName);
    if (!routing) {
      routing = await client.project(projectId, "/model-routings", {
        method: "POST",
        body: JSON.stringify({
          name: routingName,
          description: "Cost-bounded default Routing for Expert Agent Contract drafting and semantic evaluation.",
          gatewayId: gateway.id,
          routingPolicy: {
            version: 1,
            mode: "SINGLE",
            modelDeploymentId: model.id,
            fallbackModelDeploymentIds: [],
            retries: 1,
          },
          complianceDomain: "GLOBAL",
          isDefault: true,
          keyPolicy: { perInstance: true, rotationDays: 30 },
          auditPolicy: { controlPlane: true, requestLogs: true, capturePrompts: false },
        }),
      });
    } else {
      if (routing.status !== "READY") {
        routing = await client.project(
          projectId,
          `/model-routings/${encodeURIComponent(routing.id)}/refresh`,
          { method: "POST", body: "{}" },
        );
      }
      if (routing.status === "READY" && !routing.isDefault) {
        routing = await client.project(
          projectId,
          `/model-routings/${encodeURIComponent(routing.id)}`,
          { method: "PUT", body: JSON.stringify({ isDefault: true }) },
        );
      }
    }
    if (routing.status !== "READY" || !routing.isDefault) {
      throw new Error(
        `Project Routing is ${routing.status}${routing.isDefault ? "" : " and is not default"}.`,
      );
    }

    const draft = await client.project(projectId, "/expert-agents/contract-drafts", {
      method: "POST",
      body: JSON.stringify({
        intention: "Build a flexible Agent that reads an allowed GitHub repository for an arbitrary date range and summarizes verified commits with source citations, without writing to GitHub.",
      }),
    });
    if (draft.status !== "GENERATED" || draft.source?.id !== routing.id) {
      throw new Error("The real Project Routing did not generate the Agent Contract draft.");
    }

    providers = data(await client.project(projectId, "/providers"));
    models = data(await client.project(projectId, "/models"));
    let embeddingProvider = providers.find((item) =>
      item.name === embeddingProviderName && item.providerKind === "nvidia-nim"
    );
    if (!embeddingProvider) {
      const connection = {
        provider: "nvidia-nim",
        name: embeddingProviderName,
        config: { endpoint: "https://integrate.api.nvidia.com/v1" },
        credentials: { apiKey: embeddingApiKey },
      };
      const discovery = await client.project(projectId, "/providers/discover", {
        method: "POST",
        body: JSON.stringify(connection),
      });
      const selected = discovery.models.find((item) => item.modelId === embeddingModelId);
      if (!selected) throw new Error(`NVIDIA NIM did not expose ${embeddingModelId}.`);
      const created = await client.project(projectId, "/providers", {
        method: "POST",
        body: JSON.stringify({
          connection,
          models: [{
            modelId: selected.modelId,
            displayName: selected.displayName,
            modelType: selected.modelType,
            capabilities: selected.capabilities,
            inputModalities: selected.inputModalities,
            outputModalities: selected.outputModalities,
          }],
          complianceDomain: "GLOBAL",
        }),
      });
      embeddingProvider = created.account;
      models = [...models, ...created.models];
    } else if (embeddingProvider.status !== "VALIDATED") {
      embeddingProvider = await client.project(
        projectId,
        `/providers/${encodeURIComponent(embeddingProvider.id)}/validate`,
        { method: "POST", body: "{}" },
      );
      models = data(await client.project(projectId, "/models"));
    }
    const embeddingModel = models.find((item) =>
      item.providerAccountId === embeddingProvider.id
      && item.modelId === embeddingModelId
      && item.status === "VALIDATED"
    );
    if (!embeddingModel) {
      throw new Error(`NVIDIA embedding deployment ${embeddingModelId} is not VALIDATED.`);
    }

    console.log(JSON.stringify({
      projectId,
      provider: {
        id: provider.id,
        kind: provider.providerKind,
        status: provider.status,
        credentialState: provider.credentialState,
      },
      model: { id: model.id, modelId: model.modelId, status: model.status },
      routing: {
        id: routing.id,
        status: routing.status,
        isDefault: routing.isDefault,
        mode: routing.routingPolicy.mode,
      },
      contractDraft: {
        status: draft.status,
        sourceKind: draft.source.kind,
        sourceId: draft.source.id,
        generatedName: draft.draft.name,
        executionMode: draft.draft.executionMode,
        preset: draft.draft.policy.preset,
      },
      embedding: {
        providerId: embeddingProvider.id,
        providerStatus: embeddingProvider.status,
        credentialState: embeddingProvider.credentialState,
        modelId: embeddingModel.modelId,
        deploymentId: embeddingModel.id,
        modelStatus: embeddingModel.status,
      },
    }, null, 2));
  } finally {
    await client.request("/api/v1/access-context", {
      method: "PUT",
      body: JSON.stringify({
        level: projectDeveloper.level,
        resourceId: projectDeveloper.resourceId,
        roleId: projectDeveloper.roleId,
      }),
    });
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
