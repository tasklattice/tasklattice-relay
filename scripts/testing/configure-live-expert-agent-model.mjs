#!/usr/bin/env node

import { RelayClient } from "./live-hermes-e2e-lib.mjs";

const baseUrl = process.env.TALI_BASE_URL ?? "http://localhost:38080";
const departmentId = process.env.TALI_LIVE_EXPERT_AGENT_DEPARTMENT_ID ?? "dep1";
const projectId = process.env.TALI_LIVE_EXPERT_AGENT_PROJECT_ID ?? "proj1";
const username = process.env.TALI_VALIDATION_USERNAME ?? "admin";
const password = process.env.TALI_VALIDATION_PASSWORD ?? "password";
const providerName = "Department DeepSeek";
const routingName = "Department Default DeepSeek";
const embeddingProviderName = "Department NVIDIA Embeddings";
const embeddingModelId = "nvidia/llama-nemotron-embed-vl-1b-v2";

if (process.env.TALI_LIVE_MODEL_PROVISIONING !== "1") {
  throw new Error(
    "Set TALI_LIVE_MODEL_PROVISIONING=1 to authorize bounded Department Provider, Model, Routing, and Project inheritance validation.",
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

function items(value) {
  return Array.isArray(value) ? value : value?.data ?? [];
}

function contextOption(state, level, resourceId, roleId) {
  return state.options.find((option) =>
    option.level === level
    && option.resourceId === resourceId
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

function department(client, path, init) {
  return client.request(
    `/api/v1/departments/${encodeURIComponent(departmentId)}${path}`,
    init,
  );
}

async function ensureProvider(client, {
  connection,
  complianceDomain = "GLOBAL",
  selectModel,
}) {
  const providers = items(await department(client, "/providers"));
  let provider = providers.find((item) =>
    item.name === connection.name && item.providerKind === connection.provider
  );
  let models = items(await department(client, "/models"));

  if (!provider) {
    const discovery = await department(client, "/providers/discover", {
      method: "POST",
      body: JSON.stringify(connection),
    });
    const selected = selectModel(discovery.models ?? []);
    if (!selected) {
      throw new Error(`${connection.name} did not expose the required model.`);
    }
    const created = await department(client, "/providers", {
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
        complianceDomain,
      }),
    });
    provider = created.account;
    models = [...models, ...(created.models ?? [])];
  } else if (provider.status !== "VALIDATED") {
    provider = await department(
      client,
      `/providers/${encodeURIComponent(provider.id)}/validate`,
      { method: "POST", body: "{}" },
    );
    models = items(await department(client, "/models"));
  }

  const model = models.find((candidate) =>
    candidate.providerAccountId === provider.id && selectModel([candidate])
  );
  if (!model || model.status !== "VALIDATED") {
    throw new Error(`${connection.name} has no matching VALIDATED Department Model.`);
  }
  return { model, provider };
}

async function main() {
  const client = new RelayClient(baseUrl);
  await client.login(username, password);
  const accessContext = await client.request("/api/v1/access-context");
  const departmentAdmin = contextOption(
    accessContext,
    "department",
    departmentId,
    "ROLE_DEPARTMENT_ADMIN",
  );
  const projectAdmin = contextOption(
    accessContext,
    "project",
    projectId,
    "ROLE_PROJECT_ADMIN",
  );
  const projectDeveloper = contextOption(
    accessContext,
    "project",
    projectId,
    "ROLE_AGENT_DEVELOPER",
  );
  if (!departmentAdmin || !projectAdmin || !projectDeveloper) {
    throw new Error(
      "The validation Account must have Department Administrator plus Project Administrator and Agent Developer contexts.",
    );
  }

  await select(client, departmentAdmin);
  try {
    const llm = await ensureProvider(client, {
      connection: {
        provider: "deepseek",
        name: providerName,
        config: { endpoint: "https://api.deepseek.com/v1" },
        credentials: { apiKey },
      },
      selectModel: (models) => models.find((model) => model.modelId === "deepseek-chat")
        ?? models.find((model) => model.modelType === "llm"),
    });

    const gateways = items(await department(client, "/inference-gateways"));
    const gateway = gateways[0];
    if (!gateway) throw new Error("No Department LiteLLM Gateway is available.");

    const routings = items(await department(client, "/model-routings"));
    let routing = routings.find((item) => item.name === routingName);
    if (!routing) {
      routing = await department(client, "/model-routings", {
        method: "POST",
        body: JSON.stringify({
          name: routingName,
          description: "Department-managed, cost-bounded default Routing for child Project Agent development and runtime inference.",
          gatewayId: gateway.id,
          routingPolicy: {
            version: 1,
            mode: "SINGLE",
            modelDeploymentId: llm.model.id,
            fallbackModelDeploymentIds: [],
            retries: 1,
          },
          complianceDomain: "GLOBAL",
          isDefault: true,
          keyPolicy: { perInstance: true, rotationDays: 30 },
          auditPolicy: {
            controlPlane: true,
            requestLogs: true,
            capturePrompts: false,
          },
        }),
      });
    } else if (routing.status !== "READY") {
      routing = await department(
        client,
        `/model-routings/${encodeURIComponent(routing.id)}/refresh`,
        { method: "POST", body: "{}" },
      );
    }
    if (routing.status !== "READY") {
      throw new Error(`Department Routing is ${routing.status}.`);
    }

    const embedding = await ensureProvider(client, {
      connection: {
        provider: "nvidia-nim",
        name: embeddingProviderName,
        config: { endpoint: "https://integrate.api.nvidia.com/v1" },
        credentials: { apiKey: embeddingApiKey },
      },
      selectModel: (models) => models.find((model) =>
        model.modelId === embeddingModelId && model.modelType === "text-embedding"
      ),
    });

    await select(client, projectAdmin);
    const projectRoutings = items(await client.project(projectId, "/model-routings"));
    let inheritedRouting = projectRoutings.find((item) => item.id === routing.id);
    if (!inheritedRouting) {
      inheritedRouting = await client.project(
        projectId,
        `/model-routings/${encodeURIComponent(routing.id)}/inherit`,
        { method: "POST", body: "{}" },
      );
    }
    if (!inheritedRouting.isDefault) {
      inheritedRouting = await client.project(
        projectId,
        `/model-routings/${encodeURIComponent(routing.id)}`,
        { method: "PUT", body: JSON.stringify({ isDefault: true }) },
      );
    }
    if (
      inheritedRouting.status !== "READY"
      || inheritedRouting.origin?.scope !== "DEPARTMENT"
      || inheritedRouting.origin?.inherited !== true
      || !inheritedRouting.isDefault
    ) {
      throw new Error("The Project did not receive the READY Department Routing as its default.");
    }

    const projectModels = items(await client.project(projectId, "/models"));
    let inheritedEmbedding = projectModels.find((item) => item.id === embedding.model.id);
    if (!inheritedEmbedding) {
      inheritedEmbedding = await client.project(
        projectId,
        `/models/${encodeURIComponent(embedding.model.id)}/inherit`,
        { method: "POST", body: "{}" },
      );
    }
    if (
      inheritedEmbedding.status !== "VALIDATED"
      || inheritedEmbedding.origin?.scope !== "DEPARTMENT"
      || inheritedEmbedding.origin?.inherited !== true
    ) {
      throw new Error("The Project did not inherit the VALIDATED Department embedding Model.");
    }

    console.log(JSON.stringify({
      departmentId,
      projectId,
      department: {
        provider: {
          id: llm.provider.id,
          kind: llm.provider.providerKind,
          status: llm.provider.status,
        },
        model: {
          id: llm.model.id,
          modelId: llm.model.modelId,
          status: llm.model.status,
        },
        routing: {
          id: routing.id,
          status: routing.status,
          mode: routing.routingPolicy.mode,
        },
        embedding: {
          providerId: embedding.provider.id,
          providerStatus: embedding.provider.status,
          modelId: embedding.model.modelId,
          deploymentId: embedding.model.id,
          modelStatus: embedding.model.status,
        },
      },
      projectInheritance: {
        routingId: inheritedRouting.id,
        routingOrigin: inheritedRouting.origin,
        isDefault: inheritedRouting.isDefault,
        embeddingModelId: inheritedEmbedding.id,
        embeddingOrigin: inheritedEmbedding.origin,
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
