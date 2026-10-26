import { afterEach, describe, expect, it, vi } from "vitest";
import { LiteLLMClient } from "./litellm-client";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LiteLLM model validation", () => {
  it("reports the gateway version from readiness instead of the liveness response", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) =>
      new Response(JSON.stringify(String(input).endsWith("/health/readiness/details")
        ? { status: "healthy", db: "connected", litellm_version: "1.106.4" }
        : "I'm alive!"), { status: 200 }),
    ));

    await expect(new LiteLLMClient("http://litellm:4000", "master-secret")
      .testConnection()).resolves.toEqual({ ok: true, version: "1.106.4" });
  });

  it("labels embedding validation and runtime inputs for asymmetric embedding models", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        data: [{ index: 0, embedding: [0.1, 0.2] }],
      }), { status: 200 });
    }));
    const client = new LiteLLMClient("http://litellm:4000", "master-secret");

    await client.probeModel("tali/nvidia/embed", "text-embedding");
    await client.createEmbeddings("tali/nvidia/embed", ["document"], "passage");
    await client.createEmbeddings("tali/nvidia/embed", ["question"], "query");

    expect(requests).toEqual([
      expect.objectContaining({ input_type: "passage", encoding_format: "float" }),
      expect.objectContaining({ input_type: "passage", encoding_format: "float" }),
      expect.objectContaining({ input_type: "query", encoding_format: "float" }),
    ]);
  });

  it("waits for a newly registered model to propagate across LiteLLM workers", async () => {
    vi.useFakeTimers();
    const modelName = "tali/account/deepseek-v4-flash";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          message: `/chat/completions: Invalid model name passed in model=${modelName}. Call /v1/models to view available models for your key.`,
        },
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          message: `/chat/completions: Invalid model name passed in model=${modelName}. Call /v1/models to view available models for your key.`,
        },
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "chatcmpl-validation" }), {
        status: 200,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const probe = new LiteLLMClient("http://litellm:4000", "master-secret")
      .probeModel(modelName, "llm");
    await vi.runAllTimersAsync();
    await expect(probe).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a real upstream validation failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "Incorrect API key provided." },
    }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const probe = new LiteLLMClient("http://litellm:4000", "master-secret")
      .probeModel("tali/account/deepseek-v4-flash", "llm");
    await expect(probe).rejects.toThrow("Incorrect API key provided.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a readable error instead of truncated nested JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        message: "The upstream model rejected this request.",
        provider_specific_fields: { ignored: "x".repeat(500) },
      },
    }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new LiteLLMClient("http://litellm:4000", "master-secret")
        .probeModel("tali/account/model", "llm"),
    ).rejects.toThrow(
      "LiteLLM returned 400: The upstream model rejected this request.",
    );
  });
});

describe("LiteLLM Router capability inspection", () => {
  it("accepts the Complexity Router shipped by the deployed LiteLLM 1.86 line", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(JSON.stringify(url.endsWith("/model/info") ? {
        data: [{
          model_name: "production-chat",
          litellm_params: {
            model: "auto_router/complexity_router",
            complexity_router_config: {
              tiers: {
                SIMPLE: "fast",
                MEDIUM: "fast",
                COMPLEX: "strong",
                REASONING: "strong",
              },
            },
          },
          model_info: { compliance_domain: "CN_MAINLAND", fallbacks: ["backup"], request_audit: true },
        },
        { model_name: "fast", model_info: { compliance_domain: "CN_MAINLAND" } },
        { model_name: "strong", model_info: { compliance_domain: "CN_MAINLAND" } },
        { model_name: "backup", model_info: { compliance_domain: "CN_MAINLAND" } }],
      } : { version: "1.86.2" }), { status: 200 });
    }));
    const result = await new LiteLLMClient("http://litellm:4000", "master-secret").inspectModelRouting("production-chat");
    expect(result.capabilities).toMatchObject({
      automaticRouting: "ENABLED",
      routerType: "COMPLEXITY_ROUTER",
      failover: "ENABLED",
      requestAudit: "ENABLED",
    });
    expect(result.unsupportedReason).toBeUndefined();
  });

  it("redacts virtual keys echoed by LiteLLM errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("failed sk-super-secret-value master-secret", { status: 500 })));
    await expect(new LiteLLMClient("http://litellm:4000", "master-secret").inspectModelRouting("production-chat"))
      .rejects.not.toThrow(/sk-super-secret-value|master-secret/);
  });

  it("resolves Auto Router tiers, advanced capabilities, and candidate compliance", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(JSON.stringify(url.endsWith("/model/info") ? {
        data: [
          {
            model_name: "production-chat",
            litellm_params: {
              model: "auto_router/complexity_router",
              complexity_router_config: {
                tiers: { SIMPLE: "fast", MEDIUM: "balanced", COMPLEX: "strong", REASONING: "reasoning" },
                adaptive: true,
              },
              context_window_fallbacks: [{ strong: ["reasoning"] }],
            },
            model_info: { request_audit: true },
          },
          { model_name: "fast", litellm_params: { model: "openai/fast" }, model_info: { compliance_domain: "GLOBAL" } },
          { model_name: "balanced", litellm_params: { model: "openai/balanced" }, model_info: { compliance_domain: "GLOBAL" } },
          { model_name: "strong", litellm_params: { model: "anthropic/strong" }, model_info: { compliance_domain: "CN_MAINLAND" } },
          { model_name: "reasoning", litellm_params: { model: "openai/reasoning" }, model_info: { compliance_domain: "GLOBAL" } },
        ],
      } : { version: "1.94.1" }), { status: 200 });
    }));

    const result = await new LiteLLMClient("http://litellm:4000", "master-secret").inspectModelRouting("production-chat");

    expect(result).toMatchObject({
      exists: true,
      modelCount: 4,
      complianceDomains: expect.arrayContaining(["CN_MAINLAND", "GLOBAL"]),
      complianceUnknown: false,
      capabilities: {
        automaticRouting: "ENABLED",
        routerType: "COMPLEXITY_ROUTER",
        complexityTierCount: 4,
        sessionAffinity: "UNKNOWN",
        adaptiveRouting: "UNKNOWN",
        contextWindowFallback: "ENABLED",
        requestAudit: "ENABLED",
      },
    });
    expect(result.configurationHash).toMatch(/^sha256:/);
  });

  it("creates a managed complexity route and configures the runtime fallback API", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (url.endsWith("/model/info"))
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    const client = new LiteLLMClient("http://litellm:4000", "master-secret");

    await client.reconcileModelRoutingRoute({
      strategy: "COMPLEXITY",
      alias: "tali-routing-routing-a",
      modelRoutingId: "routing-a",
      complianceDomain: "GLOBAL",
      tiers: {
        SIMPLE: "tali/gemini/flash",
        MEDIUM: "tali/gemini/flash",
        COMPLEX: "tali/anthropic/sonnet",
        REASONING: "tali/anthropic/sonnet",
      },
      defaultModel: "tali/gemini/flash",
      fallbackModels: ["tali/qwen/max"],
      retries: 2,
      requestAudit: true,
    });

    expect(calls).toEqual([
      expect.objectContaining({ url: "http://litellm:4000/model/info", method: "GET" }),
      expect.objectContaining({
        url: "http://litellm:4000/model/new",
        method: "POST",
        body: {
          model_name: "tali-routing-routing-a",
          litellm_params: {
            model: "auto_router/complexity_router",
            complexity_router_config: {
              tiers: {
                SIMPLE: "tali/gemini/flash",
                MEDIUM: "tali/gemini/flash",
                COMPLEX: "tali/anthropic/sonnet",
                REASONING: "tali/anthropic/sonnet",
              },
              default_model: "tali/gemini/flash",
            },
            complexity_router_default_model: "tali/gemini/flash",
            num_retries: 2,
          },
          model_info: {
            managed_by: "tali",
            tali_resource: "model_routing_route",
            model_routing_id: "routing-a",
            routing_strategy: "COMPLEXITY",
            compliance_domain: "GLOBAL",
            request_audit: true,
          },
        },
      }),
      expect.objectContaining({
        url: "http://litellm:4000/fallback",
        method: "POST",
        body: {
          model: "tali-routing-routing-a",
          fallback_models: ["tali/qwen/max"],
          fallback_type: "general",
        },
      }),
    ]);
  });

  it("removes a stale managed route for a single model without creating an Auto Router", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (url.endsWith("/model/info"))
        return new Response(JSON.stringify({ data: [
          {
            model_name: "tali-routing-routing-single",
            litellm_params: { model: "auto_router/complexity_router" },
            model_info: {
              id: "stale-route-id",
              managed_by: "tali",
              tali_resource: "model_routing_route",
              model_routing_id: "routing-single",
            },
          },
          {
            model_name: "tali/deepseek/chat",
            litellm_params: { model: "deepseek/chat" },
            model_info: { id: "deepseek-chat-id" },
          },
        ] }), { status: 200 });
      if (init?.method === "DELETE")
        return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    const client = new LiteLLMClient("http://litellm:4000", "master-secret");

    await client.reconcileModelRoutingRoute({
      strategy: "SINGLE",
      alias: "tali-routing-routing-single",
      modelRoutingId: "routing-single",
      complianceDomain: "CN_MAINLAND",
      defaultModel: "tali/deepseek/chat",
      fallbackModels: [],
      retries: 2,
      requestAudit: true,
    });

    expect(calls).toContainEqual(expect.objectContaining({
      url: "http://litellm:4000/model/delete",
      method: "POST",
      body: {
        id: "stale-route-id",
      },
    }));
    expect(calls.some((call) => call.url.endsWith("/model/new"))).toBe(false);
    expect(calls.some((call) =>
      JSON.stringify(call.body ?? "").includes("auto_router/")
    )).toBe(false);
  });

  it("creates a managed semantic route using LiteLLM's v1.86 contract", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (url.endsWith("/model/info"))
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (init?.method === "DELETE")
        return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    const client = new LiteLLMClient("http://litellm:4000", "master-secret");

    await client.reconcileModelRoutingRoute({
      strategy: "SEMANTIC",
      alias: "tali-routing-routing-semantic",
      modelRoutingId: "routing-semantic",
      complianceDomain: "EU_EEA",
      defaultModel: "tali/openai/general",
      embeddingModel: "tali/openai/embedding",
      routes: [{
        intent: "coding",
        description: "Programming and debugging requests.",
        model: "tali/anthropic/code",
        utterances: ["Debug this function", "Design an API"],
        scoreThreshold: 0.5,
      }],
      fallbackModels: [],
      retries: 2,
      requestAudit: true,
    });

    const createCall = calls.find((call) =>
      call.url.endsWith("/model/new")
    );
    expect(createCall?.body).toMatchObject({
      model_name: "tali-routing-routing-semantic",
      litellm_params: {
        model: "auto_router/tali-routing-routing-semantic",
        auto_router_default_model: "tali/openai/general",
        auto_router_embedding_model: "tali/openai/embedding",
        num_retries: 2,
      },
      model_info: {
        managed_by: "tali",
        routing_strategy: "SEMANTIC",
        compliance_domain: "EU_EEA",
      },
    });
    const config = JSON.parse(
      String(
        (
          createCall?.body as {
            litellm_params?: { auto_router_config?: string };
          }
        )?.litellm_params?.auto_router_config,
      ),
    );
    expect(config).toEqual({
      routes: [{
        name: "tali/anthropic/code",
        description: "Programming and debugging requests.",
        utterances: ["Debug this function", "Design an API"],
        score_threshold: 0.5,
        metadata: { tali_intent: "coding" },
      }],
    });
  });

  it("patches only a route owned by the same Model Routing", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/model/info")) {
        return new Response(JSON.stringify({
          data: [{
            model_name: "tali-routing-routing-a",
            model_info: {
              id: "router-model-id",
              managed_by: "somebody-else",
            },
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new LiteLLMClient("http://litellm:4000", "master-secret");

    await expect(client.reconcileModelRoutingRoute({
      strategy: "COMPLEXITY",
      alias: "tali-routing-routing-a",
      modelRoutingId: "routing-a",
      complianceDomain: "GLOBAL",
      tiers: {
        SIMPLE: "fast",
        MEDIUM: "fast",
        COMPLEX: "strong",
        REASONING: "strong",
      },
      defaultModel: "fast",
      fallbackModels: [],
      retries: 1,
      requestAudit: true,
    })).rejects.toThrow("not owned");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a model-restricted Team key with compliance metadata", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(bodies.length === 1
        ? { team_id: "team-a" }
        : { key: "sk-instance-secret", token: "token-a" }), { status: 200 });
    }));
    const client = new LiteLLMClient("http://litellm:4000", "master-secret");

    const teamId = await client.createModelRoutingTeam({
      alias: "tali-routing-a",
      modelAlias: "production-chat",
      modelRoutingId: "routing-a",
      complianceDomain: "GLOBAL",
    });
    const key = await client.createModelRoutingKey({
      agentId: "agent-a",
      alias: "tali/routing-a/agent-a",
      modelAlias: "production-chat",
      teamId,
      modelRoutingId: "routing-a",
      complianceDomain: "GLOBAL",
    });

    expect(key).toEqual({ secret: "sk-instance-secret", tokenId: "token-a" });
    expect(bodies).toEqual([
      expect.objectContaining({
        models: ["production-chat"],
        metadata: expect.objectContaining({ model_routing_id: "routing-a", compliance_domain: "GLOBAL" }),
      }),
      expect.objectContaining({
        team_id: "team-a",
        user_id: "agent-a",
        models: ["production-chat"],
        metadata: expect.objectContaining({ model_routing_id: "routing-a", agent_id: "agent-a", compliance_domain: "GLOBAL" }),
      }),
    ]);
  });
});

describe("LiteLLM Virtual Key lifecycle", () => {
  it("blocks retained keys instead of deleting their billing identity", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      token: "hashed-instance-key",
      blocked: true,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new LiteLLMClient("http://litellm:4000", "master-secret")
      .blockKey("hashed-instance-key");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://litellm:4000/key/block",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ key: "hashed-instance-key" }),
      }),
    );
  });

  it("treats an already removed legacy key as completed cleanup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { message: "Key not found." },
    }), { status: 404 })));

    await expect(
      new LiteLLMClient("http://litellm:4000", "master-secret")
        .blockKey("legacy-deleted-key"),
    ).resolves.toBeUndefined();
  });
});

describe("LiteLLM spend logs", () => {
  it("uses the paginated Team-scoped spend endpoint and includes the requested end day", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response(JSON.stringify({
      data: [{
        request_id: "request-today",
        request_start_time: "2026-07-23T09:30:03.402Z",
        spend: 0.01,
      }],
      total_pages: 1,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const logs = await new LiteLLMClient("http://litellm:4000", "master-secret")
      .listSpendLogs("2026-07-01", "2026-07-23", "team-project");

    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.pathname).toBe("/spend/logs/v2");
    expect(requestedUrl.searchParams.get("start_date")).toBe("2026-07-01 00:00:00");
    expect(requestedUrl.searchParams.get("end_date")).toBe("2026-07-24 00:00:00");
    expect(requestedUrl.searchParams.get("team_id")).toBe("team-project");
    expect(requestedUrl.searchParams.get("page_size")).toBe("100");
    expect(logs).toEqual([
      expect.objectContaining({
        request_id: "request-today",
        spend: 0.01,
      }),
    ]);
  });
});
