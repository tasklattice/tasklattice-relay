import { afterEach, describe, expect, it, vi } from "vitest";
import { LiteLLMClient } from "./litellm-client";

afterEach(() => vi.unstubAllGlobals());

describe("LiteLLM registration ownership", () => {
  it("uses caller-owned IDs and separate aliases for concurrent attempts", async () => {
    const requests: Array<{ model_info: { id: string } }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      requests.push(JSON.parse(init.body)); return new Response("{}");
    }));
    const client = new LiteLLMClient("http://litellm.test", "test-master");
    const input = {
      accountId: "11111111-1111-4111-8111-111111111111", providerKind: "deepseek" as const,
      model: { modelId: "deepseek-chat", displayName: "Chat", modelType: "llm" as const },
      litellmParams: { model: "deepseek/deepseek-chat" }, complianceDomain: "GLOBAL" as const, endpointRegion: "global",
    };
    const first = await client.registerModel({ ...input, registrationId: "22222222-2222-4222-8222-222222222222" });
    const second = await client.registerModel({ ...input, registrationId: "33333333-3333-4333-8333-333333333333" });
    expect(first).not.toBe(second);
    expect(requests[0]?.model_info.id).toBe("22222222-2222-4222-8222-222222222222");
    expect(requests[1]?.model_info.id).toBe("33333333-3333-4333-8333-333333333333");
  });

  it.each([400, 404])("treats confirmed absent IDs as already cleaned (%s)", async (status) => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ error: { message: "Model with id=attempt-id not found in db" } }), { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new LiteLLMClient("http://litellm.test", "test-master").deleteModelById("attempt-id")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ id: "attempt-id" });
  });

  it("does not swallow unrelated deletion failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid credentials" } }), { status: 400 })));
    await expect(new LiteLLMClient("http://litellm.test", "test-master").deleteModelById("attempt-id")).rejects.toThrow("Invalid credentials");
  });

  it("refuses legacy alias deletion when more than one model matches", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [
      { model_name: "shared", model_info: { id: "healthy" } },
      { model_name: "shared", model_info: { id: "new-attempt" } },
    ] })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new LiteLLMClient("http://litellm.test", "test-master").deleteModel("shared")).rejects.toThrow("Ambiguous");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
