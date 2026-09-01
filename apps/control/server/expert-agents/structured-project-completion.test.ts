import { describe, expect, it, vi } from "vitest";
import { structuredProjectCompletion } from "./structured-project-completion";

const baseInput = {
  baseUrl: "http://litellm.test",
  maxTokens: 100,
  messages: [{ role: "system" as const, content: "Return the requested object." }],
  model: "project/model",
  operation: "Contract draft",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["result"],
    properties: { result: { type: "string" } },
  },
  schemaName: "contract_draft",
  secret: "short-lived-project-key",
  temperature: 0.1,
};

describe("structuredProjectCompletion", () => {
  it("retries without native response_format only when the model rejects that feature", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "This response_format type is unavailable now" },
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"result":"ready"}' } }],
      }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(structuredProjectCompletion({
      ...baseInput,
      fetchImplementation,
    })).resolves.toEqual({ result: "ready" });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchImplementation.mock.calls[0]?.[1]?.body as string);
    const secondBody = JSON.parse(fetchImplementation.mock.calls[1]?.[1]?.body as string);
    expect(firstBody.response_format.type).toBe("json_schema");
    expect(secondBody.response_format).toBeUndefined();
    expect(secondBody.messages[0].content).toContain("must satisfy this schema");
  });

  it("does not downgrade authentication or unrelated model failures", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "invalid API key" } }),
      { status: 401 },
    ));

    await expect(structuredProjectCompletion({
      ...baseInput,
      fetchImplementation,
    })).rejects.toThrow("401");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("accepts a JSON-only Markdown fence but rejects non-JSON prose", async () => {
    const fencedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '```json\n{"result":"ready"}\n```' } }],
    }), { status: 200 }));
    await expect(structuredProjectCompletion({
      ...baseInput,
      fetchImplementation: fencedFetch,
    })).resolves.toEqual({ result: "ready" });

    const proseFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'Here is the result: {"result":"ready"}' } }],
    }), { status: 200 }));
    await expect(structuredProjectCompletion({
      ...baseInput,
      fetchImplementation: proseFetch,
    })).rejects.toThrow("invalid JSON");
  });
});
