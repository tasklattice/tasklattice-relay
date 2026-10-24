import { describe, expect, it } from "vitest";
import { cleanAgentRequestHeaders, openClawConnectFrame, openClawRequestFrame, parseAgentUiPath } from "./proxy";
import { agentDocumentPolicy, injectAgentDocument } from "./document";

const id = "11111111-1111-4111-8111-111111111111";
const credential = "a".repeat(43);
const prefix = `/_agent-ui/${id}/${credential}/`;

describe("Agent UI isolation boundary", () => {
  it("requires a separate capability and rejects encoded route escapes", () => {
    expect(parseAgentUiPath(`https://relay.test${prefix}api/chat?q=hello`)).toMatchObject({ id, credential, path: "/api/chat?q=hello" });
    for (const path of [`/_agent-ui/${id}/`, prefix + "%2fapi", prefix + "%252fapi", prefix + "%5capi", prefix + "a//b"]) {
      expect(() => parseAgentUiPath(`https://relay.test${path}`)).toThrow();
    }
  });
  it("does not send Control or forwarding credentials to an Agent", () => {
    const headers = cleanAgentRequestHeaders(new Headers({ cookie: "tali-relay.session_token=secret", authorization: "Bearer user", host: "attacker", "x-forwarded-host": "metadata", "x-forwarded-for": "127.0.0.1", "x-forwarded-prefix": "/forged", "x-tali-runtime-target": "other-project", "content-type": "application/json" }));
    expect([...headers]).toEqual([["content-type", "application/json"]]);
  });
  it("enforces opaque-origin sandboxing even on direct document navigation", () => {
    const policy = agentDocumentPolicy("https://relay.test", prefix);
    expect(policy).toContain("sandbox allow-scripts allow-forms allow-downloads;");
    expect(policy).not.toContain("allow-same-origin");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain(`connect-src https://relay.test${prefix} wss://relay.test${prefix}`);

  });
  it("keeps root assets inside the authenticated prefix and removes upstream base/refresh", () => {
    const html = injectAgentDocument('<html><head><base href="https://evil.test"><meta http-equiv="refresh" content="0;url=/api"></head><script type="module" src="/assets/app.js"></script></html>', prefix, "hermes");
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain(`src="${prefix}assets/app.js"`);
  });
  it("does not allow a browser to choose OpenClaw identity, credentials, roles or scopes", () => {
    const result = JSON.parse(openClawConnectFrame(JSON.stringify({ type: "req", id: "connect-1", method: "connect", params: {
      role: "node", scopes: ["operator.admin"], auth: { token: "browser-token" }, device: { signature: "forged" },
    } }), "server-token"));
    expect(result.params.auth).toEqual({ token: "server-token" });
    expect(result.params.device).toBeUndefined();
    expect(result.params.role).toBe("operator");
    expect(result.params.scopes).not.toContain("operator.admin");
    expect(result.params.client).toMatchObject({ id: "gateway-client", mode: "backend" });
    expect(result.params).toMatchObject({ minProtocol: 4, maxProtocol: 4 });
    expect(() => openClawConnectFrame('{"method":"config.set"}', "secret")).toThrow();
  });
  it("keeps message subscriptions within the backend identity's capabilities", () => {
    const frame = { type: "req", id: "subscribe-1", method: "sessions.messages.subscribe",
      params: { sessionKey: "agent:main:main", includeApprovals: true } };
    expect(JSON.parse(openClawRequestFrame(JSON.stringify(frame)))).toEqual({
      ...frame, params: { ...frame.params, includeApprovals: false },
    });
    const chat = JSON.stringify({ type: "req", id: "chat-1", method: "chat.send", params: { message: "hello" } });
    expect(openClawRequestFrame(chat)).toBe(chat);
    for (const method of ["connect", "device.pair.approve", "node.pair.approve"]) {
      expect(() => openClawRequestFrame(JSON.stringify({ method }))).toThrow("Credential operation denied");
    }
  });
});
