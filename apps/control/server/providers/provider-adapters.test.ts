import { afterEach, describe, expect, it, vi } from "vitest";
import {
  providerConnectionDraftSchema,
  providerKinds,
  type ProviderConnectionDraft,
} from "@tali/contracts";
import { createProviderDraft } from "../../src/components/providers/provider-ui-registry";
import { providerAdapterRegistry } from "./provider-adapters";

describe("providerAdapterRegistry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers exactly one adapter for every built-in Provider", () => {
    expect(Object.keys(providerAdapterRegistry).sort()).toEqual([...providerKinds].sort());
    expect(new Set(Object.values(providerAdapterRegistry).map((adapter) => adapter.kind)).size).toBe(20);
  });

  it("builds native LiteLLM parameters for regional, cloud, and custom Providers", () => {
    const qwen = {
      provider: "qwen",
      name: "Qwen",
      config: { region: "international", endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
      credentials: { apiKey: "dashscope-secret" },
    } satisfies ProviderConnectionDraft;
    expect(providerAdapterRegistry.qwen.toLiteLLMParams(qwen, {
      modelId: "qwen-plus",
      displayName: "Qwen Plus",
      modelType: "llm",
    })).toMatchObject({ model: "dashscope/qwen-plus", api_key: "dashscope-secret" });

    const bedrock = {
      provider: "aws-bedrock",
      name: "Bedrock",
      config: { region: "us-east-1", roleArn: "arn:aws:iam::123:role/llm" },
      credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
    } satisfies ProviderConnectionDraft;
    expect(providerAdapterRegistry["aws-bedrock"].toLiteLLMParams(bedrock, {
      modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      displayName: "Claude",
      modelType: "llm",
    })).toMatchObject({ model: "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0", aws_region_name: "us-east-1" });

    const custom = {
      provider: "custom-anthropic-compatible",
      name: "Custom Anthropic",
      config: { endpoint: "https://anthropic.example.com" },
      credentials: { apiKey: "secret" },
    } satisfies ProviderConnectionDraft;
    expect(providerAdapterRegistry["custom-anthropic-compatible"].toLiteLLMParams(custom, {
      modelId: "claude-local",
      displayName: "Claude Local",
      modelType: "llm",
    })).toMatchObject({ model: "anthropic/claude-local", api_base: "https://anthropic.example.com" });
  });

  it("maps every built-in Provider to its LiteLLM model prefix", () => {
    const expectedModels = {
      openai: "openai/model-id",
      anthropic: "anthropic/model-id",
      gemini: "gemini/model-id",
      deepseek: "deepseek/model-id",
      qwen: "dashscope/model-id",
      moonshot: "moonshot/model-id",
      zai: "zai/model-id",
      minimax: "minimax/model-id",
      "baidu-qianfan": "openai/model-id",
      volcengine: "volcengine/model-id",
      "nvidia-nim": "nvidia_nim/model-id",
      "azure-openai": "azure/model-id",
      "aws-bedrock": "bedrock/model-id",
      "vertex-ai": "vertex_ai/model-id",
      openrouter: "openrouter/model-id",
      ollama: "ollama_chat/model-id",
      vllm: "hosted_vllm/model-id",
      huggingface: "huggingface/model-id",
      "custom-openai-compatible": "openai/model-id",
      "custom-anthropic-compatible": "anthropic/model-id",
    } as const;

    for (const kind of providerKinds) {
      const params = providerAdapterRegistry[kind].toLiteLLMParams(
        createProviderDraft(kind),
        { modelId: "model-id", displayName: "Model", modelType: "llm" },
      );
      expect(params.model).toBe(expectedModels[kind]);
    }
  });

  it("maps Provider-specific cloud and gateway credentials", () => {
    const model = { modelId: "model-id", displayName: "Model", modelType: "llm" } as const;

    expect(providerAdapterRegistry["azure-openai"].toLiteLLMParams({
      provider: "azure-openai",
      name: "Azure",
      config: { endpoint: "https://example.openai.azure.com", apiVersion: "2025-04-01-preview", deployment: "gpt-prod" },
      credentials: { apiKey: "azure-secret" },
    }, model)).toMatchObject({ model: "azure/gpt-prod", api_version: "2025-04-01-preview", api_key: "azure-secret" });

    expect(providerAdapterRegistry["vertex-ai"].toLiteLLMParams({
      provider: "vertex-ai",
      name: "Vertex",
      config: { project: "tali-project", location: "us-central1" },
      credentials: { serviceAccountJson: "{\"type\":\"service_account\"}" },
    }, model)).toMatchObject({ vertex_project: "tali-project", vertex_location: "us-central1", vertex_credentials: "{\"type\":\"service_account\"}" });

    expect(providerAdapterRegistry.openrouter.toLiteLLMParams({
      provider: "openrouter",
      name: "OpenRouter",
      config: { endpoint: "https://openrouter.ai/api/v1", siteUrl: "https://tali.example", appName: "TaskLattice Relay" },
      credentials: { apiKey: "router-secret" },
    }, model)).toMatchObject({ extra_headers: { "HTTP-Referer": "https://tali.example", "X-Title": "TaskLattice Relay" } });

    expect(providerAdapterRegistry["baidu-qianfan"].toLiteLLMParams({
      provider: "baidu-qianfan",
      name: "Qianfan",
      config: { endpoint: "https://qianfan.baidubce.com/v2", appId: "qianfan-app" },
      credentials: { apiKey: "qianfan-secret" },
    }, model)).toMatchObject({ api_base: "https://qianfan.baidubce.com/v2", extra_headers: { appid: "qianfan-app" } });

    expect(providerAdapterRegistry.volcengine.toLiteLLMParams({
      provider: "volcengine",
      name: "Volcengine",
      config: { endpoint: "https://ark.cn-beijing.volces.com/api/v3", endpointId: "ep-123" },
      credentials: { apiKey: "ark-secret" },
    }, model)).toMatchObject({ model: "volcengine/ep-123", api_key: "ark-secret" });

    expect(providerAdapterRegistry.huggingface.toLiteLLMParams({
      provider: "huggingface",
      name: "Hugging Face",
      config: { mode: "dedicated", endpoint: "https://dedicated.endpoints.huggingface.cloud" },
      credentials: { apiKey: "hf-secret" },
    }, model)).toMatchObject({ model: "huggingface/tgi", api_base: "https://dedicated.endpoints.huggingface.cloud", api_key: "hf-secret" });
  });

  it("adds Hindsight-compatible defaults for the NVIDIA memory embedding model", () => {
    const draft = {
      provider: "nvidia-nim",
      name: "NVIDIA NIM",
      config: { endpoint: "https://integrate.api.nvidia.com/v1" },
      credentials: { apiKey: "nvidia-secret" },
    } satisfies ProviderConnectionDraft;

    expect(providerAdapterRegistry["nvidia-nim"].toLiteLLMParams(draft, {
      modelId: "nvidia/llama-nemotron-embed-vl-1b-v2",
      displayName: "Llama Nemotron Embed VL 1B v2",
      modelType: "text-embedding",
    })).toMatchObject({
      model: "nvidia_nim/nvidia/llama-nemotron-embed-vl-1b-v2",
      input_type: "passage",
      dimensions: 1536,
    });

    expect(providerAdapterRegistry["nvidia-nim"].toLiteLLMParams(draft, {
      modelId: "meta/llama-3.3-70b-instruct",
      displayName: "Llama 3.3 70B Instruct",
      modelType: "llm",
    })).not.toHaveProperty("input_type");
  });

  it("preserves the connection-level TLS verification policy", () => {
    expect(providerConnectionDraftSchema.parse({
      provider: "custom-openai-compatible",
      name: "Private gateway",
      skipTlsVerify: true,
      config: { endpoint: "https://models.internal.example/v1" },
      credentials: { apiKey: "secret" },
    })).toMatchObject({ skipTlsVerify: true });
  });

  it("uses a request-scoped dispatcher only when TLS verification is skipped", async () => {
    const request = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({
      data: [{ id: "private-model" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const draft = {
      provider: "custom-openai-compatible",
      name: "Private gateway",
      skipTlsVerify: true,
      config: { endpoint: "https://models.internal.example/v1" },
      credentials: { apiKey: "secret" },
    } satisfies ProviderConnectionDraft;

    await providerAdapterRegistry["custom-openai-compatible"].discover(draft);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      dispatcher: expect.anything(),
    }));

    request.mockClear();
    await providerAdapterRegistry["custom-openai-compatible"].discover({
      ...draft,
      skipTlsVerify: false,
    });
    expect(request.mock.calls[0]?.[1]).not.toHaveProperty("dispatcher");
  });

  it("reports certificate verification failures with an actionable message", async () => {
    const cause = Object.assign(new Error("self-signed certificate"), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed", { cause });
    }));

    const result = await providerAdapterRegistry["custom-openai-compatible"].discover({
      provider: "custom-openai-compatible",
      name: "Private gateway",
      config: { endpoint: "https://models.internal.example/v1" },
      credentials: { apiKey: "secret" },
    });
    expect(result.message).toContain("TLS certificate verification failed");
    expect(result.message).toContain("Skip TLS verification");
  });
});
