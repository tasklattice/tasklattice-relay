import {
  providerPresets,
  type ModelCapability,
  type ModelInputModality,
  type ModelOutputModality,
  type ModelType,
  type ProviderConnectionDraft,
  type ProviderDiscoveryResult,
  type ProviderKind,
  type ProviderModelSelection,
  type ProviderPresetModel,
  type ProviderValidationCheck,
} from "@tali/contracts";
import { Agent } from "undici";

export interface ProviderAdapter {
  readonly kind: ProviderKind;
  discover(draft: ProviderConnectionDraft): Promise<ProviderDiscoveryResult>;
  endpoint(draft: ProviderConnectionDraft): string;
  toLiteLLMParams(
    draft: ProviderConnectionDraft,
    model: ProviderModelSelection,
  ): Record<string, unknown>;
}

const suggestedChecks = (): ProviderValidationCheck[] => [
  { id: "endpoint", label: "Endpoint reachability", status: "SKIP" },
  { id: "credentials", label: "Credential authorization", status: "SKIP" },
  { id: "catalog", label: "Curated model suggestions", status: "PASS" },
];

function preset(kind: ProviderKind) {
  const item = providerPresets.find((candidate) => candidate.id === kind);
  if (!item) throw new Error(`Provider catalog entry ${kind} is missing.`);
  return item;
}

function config(draft: ProviderConnectionDraft): Record<string, unknown> {
  return draft.config as Record<string, unknown>;
}

function credentials(draft: ProviderConnectionDraft): Record<string, unknown> {
  return draft.credentials as Record<string, unknown>;
}

function endpoint(draft: ProviderConnectionDraft): string {
  return typeof config(draft).endpoint === "string" ? String(config(draft).endpoint) : "";
}

function apiKey(draft: ProviderConnectionDraft): string {
  return typeof credentials(draft).apiKey === "string" ? String(credentials(draft).apiKey) : "";
}

function modelType(modelId: string): ModelType {
  const value = modelId.toLowerCase();
  if (value.includes("embedding") || value.includes("embed")) return "text-embedding";
  if (value.includes("transcri") || value.includes("whisper")) return "speech-to-text";
  return "llm";
}

export function classifyModelMetadata(
  modelId: string,
  type: ModelType,
): {
  capabilities: ModelCapability[];
  inputModalities: ModelInputModality[];
  outputModalities: ModelOutputModality[];
} {
  if (type === "text-embedding") {
    return {
      capabilities: ["multilingual"],
      inputModalities: ["text"],
      outputModalities: ["embedding"],
    };
  }
  if (type === "speech-to-text") {
    return {
      capabilities: ["multilingual"],
      inputModalities: ["audio"],
      outputModalities: ["text"],
    };
  }
  const value = modelId.toLowerCase();
  const vision = /(?:vision|ocr|(?:^|[-_.])vl(?:[-_.]|$)|multimodal|gpt-4o|gpt-5|gemini)/i.test(value);
  const reasoning = /(?:reason|thinking|(?:^|[-_.])o[134](?:[-_.]|$)|gpt-5|sonnet|opus|deepseek-v|deepseek-r|gemini.*pro)/i.test(value);
  const capabilities: ModelCapability[] = [
    "tool-calling",
    "structured-output",
    "multilingual",
  ];
  if (reasoning) capabilities.unshift("reasoning");
  if (vision) capabilities.push("vision", "ocr", "document-understanding");
  return {
    capabilities,
    inputModalities: vision
      ? ["text", "image", "document"]
      : ["text"],
    outputModalities: ["text"],
  };
}

function enrichModel(model: ProviderPresetModel): ProviderPresetModel {
  const inferred = classifyModelMetadata(model.modelId, model.modelType);
  return {
    ...model,
    capabilities: model.capabilities ?? inferred.capabilities,
    inputModalities: model.inputModalities ?? inferred.inputModalities,
    outputModalities: model.outputModalities ?? inferred.outputModalities,
  };
}

function toCatalogModels(kind: ProviderKind, modelIds: readonly string[]): ProviderPresetModel[] {
  const defaults = new Map<string, ProviderPresetModel>(preset(kind).defaultModels.map((model) => [model.modelId, model]));
  return [...new Set(modelIds)].map((modelId) =>
    enrichModel(defaults.get(modelId) ?? {
      modelId,
      displayName: modelId,
      modelType: modelType(modelId),
    }),
  );
}

function suggestions(kind: ProviderKind): ProviderDiscoveryResult {
  const models = preset(kind).defaultModels.map(enrichModel);
  return {
    providerKind: kind,
    mode: models.length ? "suggested" : "manual",
    models,
    checks: suggestedChecks(),
    message: models.length
      ? "This Provider does not expose a reliable model catalog. Select a suggested model or enter its deployment ID manually. Credentials are verified when models are registered."
      : "Enter the model or deployment ID exposed by this endpoint. Credentials are verified when the model is registered.",
  };
}

function apiUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

const insecureProviderDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

type ProviderFetchInit = RequestInit & { dispatcher?: Agent };

function fetchProvider(
  draft: ProviderConnectionDraft,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const request: ProviderFetchInit = {
    ...init,
    ...(draft.skipTlsVerify && new URL(url).protocol === "https:"
      ? { dispatcher: insecureProviderDispatcher }
      : {}),
  };
  return fetch(url, request);
}

const TLS_CERTIFICATE_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function providerErrorMessage(error: unknown, fallback: string): string {
  const cause = error instanceof Error && "cause" in error
    ? error.cause
    : undefined;
  const code = cause && typeof cause === "object" && "code" in cause
    ? String(cause.code)
    : "";
  if (TLS_CERTIFICATE_ERROR_CODES.has(code)) {
    return `TLS certificate verification failed (${code}). Enable Skip TLS verification only if this endpoint is trusted.`;
  }
  return error instanceof Error ? error.message : fallback;
}

async function discoverOpenAI(
  kind: ProviderKind,
  draft: ProviderConnectionDraft,
  extraHeaders: Record<string, string> = {},
): Promise<ProviderDiscoveryResult> {
  const startedAt = Date.now();
  try {
    const response = await fetchProvider(draft, apiUrl(endpoint(draft), "models"), {
      headers: {
        ...(apiKey(draft) ? { authorization: `Bearer ${apiKey(draft)}` } : {}),
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.text();
    if (!response.ok)
      throw new Error(`Provider returned ${response.status}${body ? `: ${body.slice(0, 240)}` : "."}`);
    const payload = JSON.parse(body) as { data?: Array<{ id?: unknown }> };
    const ids = (payload.data ?? []).flatMap((item) =>
      typeof item.id === "string" ? [item.id] : [],
    );
    if (!ids.length) throw new Error("The Provider returned an empty model catalog.");
    return {
      providerKind: kind,
      mode: "remote",
      models: toCatalogModels(kind, ids),
      checks: [
        { id: "endpoint", label: "Endpoint reachability", status: "PASS" },
        { id: "credentials", label: "Credential authorization", status: "PASS" },
        { id: "catalog", label: "Model catalog discovery", status: "PASS" },
      ],
      latencyMs: Date.now() - startedAt,
      message: `Connection validated. ${ids.length} models are available.`,
    };
  } catch (error) {
    const fallback = suggestions(kind);
    return {
      ...fallback,
      checks: [
        { id: "endpoint", label: "Endpoint reachability", status: "FAIL" },
        { id: "credentials", label: "Credential or catalog authorization", status: "FAIL" },
        { id: "catalog", label: "Manual model entry available", status: "PASS" },
      ],
      latencyMs: Date.now() - startedAt,
      message: `${providerErrorMessage(error, "Model discovery failed.")} You can still enter a model ID and validate it through LiteLLM.`,
    };
  }
}

async function discoverOllama(
  kind: ProviderKind,
  draft: ProviderConnectionDraft,
): Promise<ProviderDiscoveryResult> {
  const startedAt = Date.now();
  try {
    const response = await fetchProvider(draft, apiUrl(endpoint(draft), "api/tags"), {
      signal: AbortSignal.timeout(8_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);
    const payload = JSON.parse(body) as { models?: Array<{ name?: unknown }> };
    const ids = (payload.models ?? []).flatMap((item) =>
      typeof item.name === "string" ? [item.name] : [],
    );
    if (!ids.length) throw new Error("Ollama returned an empty model catalog.");
    return {
      providerKind: kind,
      mode: "remote",
      models: toCatalogModels(kind, ids),
      checks: [
        { id: "endpoint", label: "Ollama endpoint reachability", status: "PASS" },
        { id: "credentials", label: "No credential required", status: "SKIP" },
        { id: "catalog", label: "Ollama model discovery", status: "PASS" },
      ],
      latencyMs: Date.now() - startedAt,
      message: `Ollama is reachable. ${ids.length} models are available.`,
    };
  } catch (error) {
    return {
      ...suggestions(kind),
      latencyMs: Date.now() - startedAt,
      message: `${providerErrorMessage(error, "Ollama discovery failed.")} Enter a model name to continue.`,
    };
  }
}

function suggestedAdapter(
  kind: ProviderKind,
  toParams: ProviderAdapter["toLiteLLMParams"],
  resolveEndpoint: ProviderAdapter["endpoint"] = endpoint,
): ProviderAdapter {
  return {
    kind,
    endpoint: resolveEndpoint,
    discover: async () => suggestions(kind),
    toLiteLLMParams: toParams,
  };
}

function openAIAdapter(
  kind: ProviderKind,
  prefix: string,
  extraParams: (draft: ProviderConnectionDraft) => Record<string, unknown> = () => ({}),
): ProviderAdapter {
  return {
    kind,
    endpoint,
    discover: (draft) => discoverOpenAI(kind, draft),
    toLiteLLMParams: (draft, model) => ({
      model: `${prefix}/${model.modelId}`,
      api_base: endpoint(draft),
      ...(apiKey(draft) ? { api_key: apiKey(draft) } : {}),
      ...extraParams(draft),
    }),
  };
}

const anthropic = (kind: ProviderKind): ProviderAdapter => suggestedAdapter(
  kind,
  (draft, model) => ({
    model: `anthropic/${model.modelId}`,
    api_base: endpoint(draft),
    api_key: apiKey(draft),
  }),
);

export const providerAdapterRegistry = {
  openai: openAIAdapter("openai", "openai", (draft) => ({
    ...(config(draft).organization ? { organization: config(draft).organization } : {}),
  })),
  anthropic: anthropic("anthropic"),
  gemini: suggestedAdapter("gemini", (draft, model) => ({ model: `gemini/${model.modelId}`, api_key: apiKey(draft) })),
  deepseek: openAIAdapter("deepseek", "deepseek"),
  qwen: openAIAdapter("qwen", "dashscope"),
  moonshot: openAIAdapter("moonshot", "moonshot"),
  zai: openAIAdapter("zai", "zai"),
  minimax: openAIAdapter("minimax", "minimax"),
  "baidu-qianfan": openAIAdapter("baidu-qianfan", "openai", (draft) => ({
    ...(config(draft).appId ? { extra_headers: { appid: config(draft).appId } } : {}),
  })),
  volcengine: suggestedAdapter("volcengine", (draft, model) => ({
    model: `volcengine/${String(config(draft).endpointId || model.modelId)}`,
    api_key: apiKey(draft),
  })),
  "nvidia-nim": openAIAdapter("nvidia-nim", "nvidia_nim"),
  "azure-openai": suggestedAdapter("azure-openai", (draft, model) => ({
    model: `azure/${String(config(draft).deployment || model.modelId)}`,
    api_base: endpoint(draft),
    api_version: config(draft).apiVersion,
    api_key: apiKey(draft),
  })),
  "aws-bedrock": suggestedAdapter("aws-bedrock", (draft, model) => ({
    model: `bedrock/${model.modelId}`,
    aws_region_name: config(draft).region,
    aws_access_key_id: credentials(draft).accessKeyId,
    aws_secret_access_key: credentials(draft).secretAccessKey,
    ...(credentials(draft).sessionToken ? { aws_session_token: credentials(draft).sessionToken } : {}),
    ...(config(draft).roleArn ? { aws_role_name: config(draft).roleArn } : {}),
  }), (draft) => `https://bedrock-runtime.${String(config(draft).region)}.amazonaws.com`),
  "vertex-ai": suggestedAdapter("vertex-ai", (draft, model) => ({
    model: `vertex_ai/${model.modelId}`,
    vertex_project: config(draft).project,
    vertex_location: config(draft).location,
    vertex_credentials: credentials(draft).serviceAccountJson,
  }), (draft) => `https://${String(config(draft).location)}-aiplatform.googleapis.com`),
  openrouter: openAIAdapter("openrouter", "openrouter", (draft) => ({
    ...(config(draft).siteUrl || config(draft).appName ? {
      extra_headers: {
        ...(config(draft).siteUrl ? { "HTTP-Referer": config(draft).siteUrl } : {}),
        ...(config(draft).appName ? { "X-Title": config(draft).appName } : {}),
      },
    } : {}),
  })),
  ollama: {
    kind: "ollama",
    endpoint,
    discover: (draft) => discoverOllama("ollama", draft),
    toLiteLLMParams: (draft, model) => ({ model: `ollama_chat/${model.modelId}`, api_base: endpoint(draft) }),
  },
  vllm: openAIAdapter("vllm", "hosted_vllm"),
  huggingface: suggestedAdapter("huggingface", (draft, model) => {
    const provider = String(config(draft).inferenceProvider || "").trim();
    const dedicated = config(draft).mode === "dedicated";
    return {
      model: dedicated
        ? "huggingface/tgi"
        : `huggingface/${provider ? `${provider}/` : ""}${model.modelId}`,
      api_key: apiKey(draft),
      ...(config(draft).endpoint ? { api_base: config(draft).endpoint } : {}),
    };
  }, (draft) => typeof config(draft).endpoint === "string" ? String(config(draft).endpoint) : "https://huggingface.co"),
  "custom-openai-compatible": openAIAdapter("custom-openai-compatible", "openai"),
  "custom-anthropic-compatible": anthropic("custom-anthropic-compatible"),
} satisfies Record<ProviderKind, ProviderAdapter>;

export function providerAdapter(kind: ProviderKind): ProviderAdapter {
  return providerAdapterRegistry[kind];
}
