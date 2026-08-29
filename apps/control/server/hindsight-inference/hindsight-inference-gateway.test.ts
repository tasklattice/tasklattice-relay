import type { ModelDeployment, ModelRouting } from "@tali/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  HindsightInferenceGateway,
  HindsightProjectInferenceError,
  hindsightProjectKeyAlias,
  resolveHindsightChatTarget,
  resolveHindsightEmbeddingTarget,
} from "./hindsight-inference-gateway";

const bankId = `tali_${"b".repeat(40)}`;

function model(
  id: string,
  modelType: ModelDeployment["modelType"],
  options: { defaultSlot?: "CHAT" | "EMBEDDING"; status?: ModelDeployment["status"] } = {},
): ModelDeployment {
  return {
    id,
    modelId: id,
    displayName: id,
    modelType,
    litellmModelName: `tali/model/${id}`,
    status: options.status ?? "VALIDATED",
    origin: options.defaultSlot
      ? {
          scope: "DEPARTMENT",
          scopeId: "department-1",
          inherited: true,
          editable: false,
          projectDefault: { slot: options.defaultSlot, managedBy: "DEPARTMENT" },
        }
      : undefined,
  } as ModelDeployment;
}

function routing(id: string, isDefault = true): ModelRouting {
  return {
    id,
    isDefault,
    publicModelAlias: `tali-routing-${id}`,
    routingPolicy: {
      mode: "SINGLE",
      version: 1,
      modelDeploymentId: "chat",
      fallbackModelDeploymentIds: [],
      retries: 2,
    },
    status: "READY",
  } as unknown as ModelRouting;
}

describe("Hindsight Project inference resolution", () => {
  it("uses a unique auditable alias for every short-lived Project key", () => {
    const target = resolveHindsightEmbeddingTarget([model("embed", "text-embedding")]);
    const first = hindsightProjectKeyAlias("project-1", target);
    const second = hindsightProjectKeyAlias("project-1", target);
    expect(first).toMatch(/^tali-hindsight-project-1-model-embed-/);
    expect(second).not.toBe(first);
    expect(first.length).toBeLessThanOrEqual(255);
  });

  it("uses the Project default embedding Model and default Routing", () => {
    expect(resolveHindsightEmbeddingTarget([
      model("embed-a", "text-embedding"),
      model("embed-b", "text-embedding", { defaultSlot: "EMBEDDING" }),
    ])).toMatchObject({ model: "tali/model/embed-b", sourceKind: "MODEL" });
    expect(resolveHindsightChatTarget(
      [model("chat", "llm")],
      [routing("route")],
    )).toMatchObject({
      aliases: { "tali-routing-route": "tali/model/chat" },
      model: "tali-routing-route",
      routerSettings: { num_retries: 2 },
      sourceKind: "ROUTING",
    });
  });

  it("fails closed for missing or ambiguous Project model configuration", () => {
    expect(() => resolveHindsightEmbeddingTarget([])).toThrowError(HindsightProjectInferenceError);
    expect(() => resolveHindsightEmbeddingTarget([
      model("embed-a", "text-embedding"),
      model("embed-b", "text-embedding"),
    ])).toThrow(/multiple validated embedding Models/i);
    expect(() => resolveHindsightChatTarget([], [])).toThrow(/requires a READY default Routing/i);
    expect(() => resolveHindsightChatTarget([], [routing("route")]))
      .toThrow(/primary Model is unavailable/i);
  });
});

describe("HindsightInferenceGateway", () => {
  it("routes with a Project-scoped key, rewrites the model, and caches the short-lived key", async () => {
    const issueProjectKey = vi.fn(async () => ({ baseUrl: "http://litellm:4000", secret: "project-key" }));
    const requestFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      object: "list",
      data: [{ index: 0, embedding: [0, 0, 0, 1] }],
    }), { headers: { "content-type": "application/json" } }));
    const subject = new HindsightInferenceGateway(4, {
      fetch: requestFetch,
      inventory: async () => ({ models: [model("embed", "text-embedding")], routings: [] }),
      issueProjectKey,
      now: () => 1_000,
      resolveProjectId: async () => "project-1",
    });

    for (let index = 0; index < 2; index += 1) {
      const response = await subject.infer({
        bankId,
        body: { input: "memory", model: "hindsight-embedding" },
        kind: "embeddings",
      });
      expect(response.status).toBe(200);
    }

    expect(issueProjectKey).toHaveBeenCalledOnce();
    expect(requestFetch).toHaveBeenCalledTimes(2);
    const [url, init] = requestFetch.mock.calls[0]!;
    expect(url).toBe("http://litellm:4000/embeddings");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer project-key");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "tali/model/embed",
      user: bankId,
    });
  });

  it("rejects embedding output that violates the shared Hindsight dimension profile", async () => {
    const subject = new HindsightInferenceGateway(4, {
      fetch: async () => new Response(JSON.stringify({ data: [{ embedding: [0, 1] }] })),
      inventory: async () => ({ models: [model("embed", "text-embedding")], routings: [] }),
      issueProjectKey: async () => ({ baseUrl: "http://litellm:4000", secret: "project-key" }),
      now: () => 1_000,
      resolveProjectId: async () => "project-1",
    });

    await expect(subject.infer({ bankId, body: { input: "memory" }, kind: "embeddings" }))
      .rejects.toMatchObject({ code: "embedding_dimension_mismatch", status: 409 });
  });

  it("accepts the OpenAI SDK base64 float32 embedding representation", async () => {
    const embedding = Buffer.alloc(4 * Float32Array.BYTES_PER_ELEMENT).toString("base64");
    const subject = new HindsightInferenceGateway(4, {
      fetch: async () => new Response(JSON.stringify({ data: [{ embedding }] })),
      inventory: async () => ({ models: [model("embed", "text-embedding")], routings: [] }),
      issueProjectKey: async () => ({ baseUrl: "http://litellm:4000", secret: "project-key" }),
      now: () => 1_000,
      resolveProjectId: async () => "project-1",
    });

    const response = await subject.infer({ bankId, body: { input: "memory" }, kind: "embeddings" });
    expect(response.status).toBe(200);
  });

  it("does not issue a key for an unknown Bank", async () => {
    const issueProjectKey = vi.fn();
    const subject = new HindsightInferenceGateway(4, {
      fetch,
      inventory: async () => ({ models: [], routings: [] }),
      issueProjectKey,
      now: () => 1_000,
      resolveProjectId: async () => undefined,
    });
    await expect(subject.infer({ bankId, body: {}, kind: "chat" }))
      .rejects.toMatchObject({ code: "hindsight_bank_not_found", status: 404 });
    expect(issueProjectKey).not.toHaveBeenCalled();
  });
});
