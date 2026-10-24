import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ validate: vi.fn(), runner: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("./access", () => ({ validateAgentUiSession: mocks.validate, runnerRequest: mocks.runner, upstreamSecret: () => "server-secret", hermesCredentials: () => ({ cookie: "tali_hermes_session=server-cookie", token: "server-hermes-token" }), sessionLifetimeMs: 300_000, maximumSessionLifetimeMs: 3_600_000 }));
vi.mock("../http/request-origin", () => ({ requestOrigin: () => "https://relay.test" }));
vi.mock("../db/prisma", () => ({ prisma: () => ({ agentUiSession: { update: mocks.update, deleteMany: mocks.remove } }) }));
import { proxyAgentRequest } from "./proxy";
const prefix = `/_agent-ui/11111111-1111-4111-8111-111111111111/${"a".repeat(43)}/`;
const request = (path: string, init: RequestInit = {}) => new Request(`https://relay.test${prefix}${path}`, init);

describe("Agent HTTP boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.validate.mockResolvedValue({ id: "session", sandboxName: "sandbox", namespace: "project", platform: "hermes", upstreamOrigin: "http://sandbox.internal", createdAt: new Date(), authSession: { expiresAt: new Date(Date.now() + 60_000) } });
  });
  it("injects only server credentials, strips dangerous response headers and isolates native HTML", async () => {
    mocks.runner.mockResolvedValue(new Response('<head><script>window.__HERMES_SESSION_TOKEN__="server-hermes-token";</script></head><body>Native Hermes</body>', {
      headers: { "content-type": "text/html", "set-cookie": "control=attacker", "clear-site-data": '"*"', "service-worker-allowed": "/", "content-security-policy": "default-src *" },
    }));
    const response = await proxyAgentRequest(request("chat", { headers: { cookie: "Control=secret", authorization: "Bearer user-secret", "x-forwarded-host": "attacker" } }), "/project/instance/ui/");
    const html = await response.text();
    expect(html).toContain("Native Hermes");
    expect(html).not.toContain("server-hermes-token");
    expect(html).not.toContain("<iframe");
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    for (const name of ["set-cookie", "clear-site-data", "service-worker-allowed"]) expect(response.headers.has(name)).toBe(false);
    const headers = mocks.runner.mock.calls[0]![3].headers as Headers;
    expect(headers.get("cookie")).toBe("tali_hermes_session=server-cookie");
    expect(headers.get("x-hermes-session-token")).toBe("server-hermes-token");
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("x-forwarded-host")).toBe(false);
  });
  it("rejects an external redirect and maps an internal redirect to the native entry", async () => {
    mocks.runner.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    const rejected = await proxyAgentRequest(request(""));
    expect(rejected.status).toBe(502); await rejected.text();
    mocks.runner.mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: "/chat" } }));
    const accepted = await proxyAgentRequest(request(""), "/project/instance/ui/");
    expect(accepted.headers.get("location")).toBe("/project/instance/ui/chat");
    await accepted.text();
  });
  it("forwards binary data intact and preserves range response metadata", async () => {
    mocks.runner.mockResolvedValue(new Response(new Uint8Array([0, 255, 1, 128]), { status: 206, headers: { "content-type": "application/octet-stream", "content-range": "bytes 0-3/8" } }));
    const response = await proxyAgentRequest(request("file", { headers: { range: "bytes=0-3" } }));
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 255, 1, 128]);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-3/8");
  });
  it("rechecks authorization before preflight, renewal or forwarding", async () => {
    mocks.validate.mockRejectedValue(new Response(null, { status: 401 }));
    for (const method of ["GET", "OPTIONS", "POST"]) await expect(proxyAgentRequest(request("_relay/session", { method }))).rejects.toBeInstanceOf(Response);
    expect(mocks.runner).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("bounds renewal by login expiry and permits only opaque-origin session use", async () => {
    const response = await proxyAgentRequest(request("_relay/session", { method: "POST", headers: { origin: "null" } }));
    expect(response.status).toBe(204);
    expect(mocks.update.mock.calls[0]![0].data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    const rejected = await proxyAgentRequest(request("_relay/session", { method: "POST", headers: { origin: "https://evil.test" } }));
    expect(rejected.status).toBe(403);
  });
});
