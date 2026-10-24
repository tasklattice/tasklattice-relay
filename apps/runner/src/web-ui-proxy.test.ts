import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { webUiProxyOptions } from "./web-ui-proxy.js";
describe("private Web UI routing", () => {
  it("derives the Gateway from the namespace and never forwards Runner auth", () => {
    const incoming = { method: "GET", url: "/v1/sandboxes/ti-abcdefghijklm/web-ui/api/ws?q=1", headers: {
      authorization: "Bearer runner-secret", host: "attacker", "x-tali-runtime-target": "tp-abcdefghijklm", "x-forwarded-host": "attacker", "x-forwarded-for": "127.0.0.1", cookie: "tali_hermes_session=internal", upgrade: "websocket",
    } } as unknown as IncomingMessage;
    const { upstream, options } = webUiProxyOptions(incoming);
    expect(upstream.hostname).toBe("openshell-tp-abcdefghijklm.tp-abcdefghijklm.svc.cluster.local");
    expect(options.headers.host).toBe("tp-abcdefghijklm--ti-abcdefghijklm--webui.openshell.localhost:8080");
    expect(options.headers.authorization).toBeUndefined();
    expect(options.headers["x-forwarded-for"]).toBeUndefined();
    expect(options.path).toBe("/api/ws?q=1");
    expect(options.headers.upgrade).toBe("websocket");
  });
  it("rejects a missing or invalid project target", () => {
    for (const namespace of [undefined, "metadata.internal", "../../default"]) {
      expect(() => webUiProxyOptions({ url: "/v1/sandboxes/test-agent/web-ui/", headers: { "x-tali-runtime-target": namespace } } as unknown as IncomingMessage)).toThrow();
    }
  });
});
