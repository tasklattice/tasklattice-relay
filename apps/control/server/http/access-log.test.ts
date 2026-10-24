import { describe, expect, it } from "vitest";
import { accessLogRecord } from "./access-log";

describe("entry access logging", () => {
  it("never serializes credentials from normal, malformed or encoded URLs and headers", () => {
    for (const path of ["/_agent-ui/session/SECRET/token", "/%5fagent-ui/session/SECRET/token", "/unknown/SECRET", "/SECRET/instance/ui/"]) {
      const request = new Request(`https://localhost${path}?token=SECRET&code=SECRET`, {
        headers: { cookie: "session=SECRET", authorization: "Bearer SECRET", referer: "https://localhost/SECRET" },
      });
      const record = accessLogRecord(request, 403, performance.now());
      expect(JSON.stringify(record)).not.toContain("SECRET");
      expect(Object.keys(record)).toEqual(["event", "method", "route", "transport", "status", "durationMs"]);
    }
  });
  it("retains safe transport and status diagnostics", () => {
    const record = accessLogRecord(new Request("https://localhost/_agent-ui/hidden"), 101, performance.now(), true);
    expect(record).toMatchObject({ event: "http.access", method: "GET", route: "agent-ui-proxy", transport: "websocket", status: 101 });
    expect(accessLogRecord(new Request("https://localhost/api/health"), 200, performance.now()).route).toBe("health");
    for (const path of ["/project/instance/ui", "/project/instance/ui/", "/project/instance/ui/chat"]) {
      expect(accessLogRecord(new Request(`https://localhost${path}`), 200, performance.now()).route).toBe("agent-ui-document");
    }
    expect(accessLogRecord(new Request("https://localhost/project/instance/ui-other"), 404, performance.now()).route).toBe("control");
  });
});
