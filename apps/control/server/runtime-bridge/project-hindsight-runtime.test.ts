import { describe, expect, it, vi } from "vitest";
import { hindsightRuntimePath, hindsightRuntimeQuery, proxyHindsightRuntime } from "./project-hindsight-runtime";
import { MemoryRuntimeAccessDeniedError, type ProjectMemoryRuntimeService } from "./project-memory-runtime-service";

const identity = { projectId: "project-a", namespace: "ns-a", coordinatorInstanceId: "agent-a", memoryId: "memory-a" };
const config = { baseUrl: "http://hindsight.internal:8888", apiKey: "platform-secret" };
const prefix = "v1/default/banks/agent-a";
function setup() {
  const bound = vi.fn(async () => ({ memory: { id: "memory-a", providerRef: "private-bank-a" } }));
  const activity = vi.fn(async () => {});
  const runtime = { requireBoundMemory: bound, recordNativeActivity: activity } as unknown as Pick<ProjectMemoryRuntimeService, "requireBoundMemory" | "recordNativeActivity">;
  const upstream = vi.fn<typeof fetch>(async () => new Response('{"success":true}'));
  return { bound, activity, runtime, fetch: upstream, configuration: config };
}
function request(path: string, body?: unknown) {
  return new Request(`http://control.test/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer untrusted-client-secret", cookie: "admin=forbidden", "x-extra": "never-forward" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("native Hindsight runtime transport", () => {
  it.each(["memories", "memories/recall", "reflect"])("maps %s only to the current bound Bank", async (operation) => {
    const deps = setup();
    const response = await proxyHindsightRuntime(request(operation, { query: "launch code" }), identity, `${prefix}/${operation}`, deps);
    expect(response.status).toBe(200);
    expect(deps.bound).toHaveBeenCalledWith(identity);
    expect(deps.fetch).toHaveBeenCalledWith(`${config.baseUrl}/v1/default/banks/private-bank-a/${operation}`, expect.objectContaining({
      method: "POST", headers: { authorization: "Bearer platform-secret", "content-type": "application/json" }, redirect: "error",
    }));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.activity).toHaveBeenCalledTimes(operation === "memories" ? 1 : 0);
  });
  it.each(["version", `${prefix}/operations/op_123`])("authenticates %s and forwards native polling", async (path) => {
    const deps = setup();
    await proxyHindsightRuntime(request(path), identity, path, deps);
    expect(deps.bound).toHaveBeenCalledOnce();
    expect(deps.fetch).toHaveBeenCalledOnce();
  });
  it.each([
    ["POST", "v1/default/banks/agent-b/memories"],
    ["POST", "v1/default/banks/private-bank-a/memories"],
    ["DELETE", `${prefix}/memories`],
    ["GET", "v1/default/banks"],
    ["PATCH", `${prefix}/config`],
    ["POST", `${prefix}/import`],
    ["DELETE", `${prefix}/knowledge-base/nodes/page-a`],
    ["POST", `${prefix}/../agent-b/memories`],
    ["POST", `${prefix}/%2e%2e/memories`],
    ["POST", `${prefix}/memories?bank_id=other`],
  ])("rejects unauthorized %s %s", (method, path) => {
    expect(() => hindsightRuntimePath(method, path, "agent-a", "private-bank-a")).toThrow(MemoryRuntimeAccessDeniedError);
  });
  it("allows bounded native content queries but rejects Bank/tenant overrides", () => {
    expect(hindsightRuntimeQuery(`${prefix}/documents`, new URLSearchParams("tags=source%3Agit&limit=10"))).toBe("?tags=source%3Agit&limit=10");
    expect(hindsightRuntimeQuery(`${prefix}/documents`, new URLSearchParams("tags=source%3Agit&tags_match=all_strict"))).toBe("?tags=source%3Agit&tags_match=all_strict");
    for (const query of ["bank_id=other", "tenant_id=other", "limit=501", "limit=2&limit=3", "offset=-1", "tags_match=unknown"]) {
      expect(() => hindsightRuntimeQuery(`${prefix}/documents`, new URLSearchParams(query))).toThrow(MemoryRuntimeAccessDeniedError);
    }
    expect(() => hindsightRuntimeQuery(`${prefix}/memories`, new URLSearchParams("q=secret"))).toThrow();
  });
  it("never forwards server configuration secrets to the plugin", async () => {
    const deps = setup();
    deps.fetch.mockResolvedValueOnce(Response.json({ config: { store_document_text: false, api_key: "secret" }, overrides: { llm_api_key: "secret" } }));
    const response = await proxyHindsightRuntime(request(`${prefix}/config`), identity, `${prefix}/config`, deps);
    expect(await response.json()).toEqual({ config: { store_document_text: false }, overrides: {} });
  });
  it.each(["documents", "operations", "knowledge-base/tree", "knowledge-base/search", "knowledge-base/pages/page-a"])("scopes native %s reads to the bound Bank", async operation => {
    const deps = setup();
    await proxyHindsightRuntime(request(`${prefix}/${operation}`), identity, `${prefix}/${operation}`, deps);
    expect(deps.fetch.mock.calls[0]![0]).toBe(`${config.baseUrl}/v1/default/banks/private-bank-a/${operation}`);
    expect(() => hindsightRuntimePath("GET", `v1/default/banks/agent-b/${operation}`, "agent-a", "private-bank-a")).toThrow();
  });
  it("checks revocation before any upstream call, including version", async () => {
    const deps = setup();
    deps.bound.mockRejectedValueOnce(new MemoryRuntimeAccessDeniedError());
    await expect(proxyHindsightRuntime(request("version"), identity, "version", deps)).rejects.toThrow(MemoryRuntimeAccessDeniedError);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it("redacts content while preserving native document and async semantics", async () => {
    const deps = setup();
    const body = { items: [{ content: "Contact dev@example.com. api_key=sk-privatecredential", update_mode: "append", timestamp: "2026-10-24T00:00:00Z" }], document_id: "session-123", async: true };
    await proxyHindsightRuntime(request("retain", body), identity, `${prefix}/memories`, deps);
    const sent = JSON.parse(deps.fetch.mock.calls[0]![1]!.body as string);
    expect(sent).toMatchObject({ document_id: "session-123", async: true, items: [{ update_mode: "append", timestamp: body.items[0]!.timestamp }] });
    expect(sent.items[0].content).toContain("[REDACTED]");
    expect(sent.items[0].content).not.toContain("example.com");
  });
  it("rejects oversized payloads before forwarding", async () => {
    const deps = setup();
    expect((await proxyHindsightRuntime(request("retain", { items: [{ content: "a".repeat(256 * 1024) }] }), identity, `${prefix}/memories`, deps)).status).toBe(400);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it("does not expose provider errors or response headers", async () => {
    const deps = setup();
    deps.fetch.mockResolvedValueOnce(new Response("platform-secret and private-bank-a", { status: 500, headers: { "set-cookie": "secret" } }));
    const response = await proxyHindsightRuntime(request("version"), identity, "version", deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
