import { describe, expect, it, vi } from "vitest";
import { createTestStore } from "../test/store";
import type { SecretStore } from "../secrets/secret-store";
import { ElasticsearchVectorStoreBridge } from "./elasticsearch-vector-store-bridge";

describe("ElasticsearchVectorStoreBridge", () => {
  it("maps semantic_text search results to the LiteLLM Vector Store format", async () => {
    const store = createTestStore();
    await store.saveKnowledgeSourceDefinition({
      id: "operations-search",
      name: "Operations search",
      description: "Operational knowledge indexed for semantic vector search.",
      vectorStoreId: "knowledge-chunks",
      provider: "elasticsearch",
      apiBase: "https://elastic.example.test",
      semanticField: "content_semantic",
      contentField: "document.content",
      credentialReference: "k8s://tali/elasticsearch#API_KEY",
      status: "REGISTERED",
      lastReconciliationError: null,
      topK: 8,
    });
    const secrets: SecretStore = {
      referenceFor: (projectId, resourceId) => `memory://${projectId}/${resourceId}`,
      put: vi.fn(),
      get: vi.fn(async () => "encoded-api-key"),
      delete: vi.fn(),
    };
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            hits: {
              hits: [
                {
                  _index: "knowledge-chunks",
                  _id: "runbook-42",
                  _score: 0.91,
                  _source: {
                    document: {
                      content:
                        "Restart the service after rotating credentials.",
                    },
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const bridge = new ElasticsearchVectorStoreBridge(
      store,
      secrets,
      fetcher as typeof fetch,
    );

    const result = await bridge.search("knowledge-chunks", {
      query: "How do I rotate credentials?",
      max_num_results: 4,
      filters: { type: "eq", key: "environment", value: "production" },
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://elastic.example.test/knowledge-chunks/_search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "ApiKey encoded-api-key",
        }),
      }),
    );
    const request = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(request).toEqual(
      expect.objectContaining({
        size: 4,
        _source: ["document.content"],
        query: {
          bool: {
            must: [
              {
                match: {
                  content_semantic: { query: "How do I rotate credentials?" },
                },
              },
            ],
            filter: [{ term: { environment: "production" } }],
          },
        },
      }),
    );
    expect(result).toEqual({
      object: "vector_store.search_results.page",
      search_query: "How do I rotate credentials?",
      data: [
        {
          score: 0.91,
          content: [
            {
              type: "text",
              text: "Restart the service after rotating credentials.",
            },
          ],
          file_id: "runbook-42",
          filename: "knowledge-chunks/runbook-42",
          attributes: {
            elasticsearch_index: "knowledge-chunks",
            elasticsearch_id: "runbook-42",
          },
        },
      ],
    });
  });
});
