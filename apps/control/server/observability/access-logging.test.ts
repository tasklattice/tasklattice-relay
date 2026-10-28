import { H3 } from "h3";
import type { NitroRuntimeHooks } from "nitro/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { developmentControlConfig, setControlConfigForTests } from "../config/control-config";
import { errorResponse } from "../http/responses";
import originGuard from "../middleware/browser-origin-guard";
import accessLogging from "../plugins/access-logging";

beforeEach(() => {
  setControlConfigForTests(developmentControlConfig());
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setControlConfigForTests(undefined);
});

function app(hooks: Partial<NitroRuntimeHooks> = {}) {
  const server = new H3({
    onRequest: (event) => hooks.request?.(event),
    onResponse: (response, event) => hooks.response?.(response, event),
    onError(error, event) {
      hooks.error?.(error, { event });
      return new Response(null, { status: 500 });
    },
  });
  accessLogging({ h3: server, hooks: { hook(name: keyof NitroRuntimeHooks, handler: never) {
    hooks[name] = handler;
  } } } as unknown as Parameters<typeof accessLogging>[0]);
  return server;
}
function records() {
  return [console.info, console.warn, console.error].flatMap((method) =>
    vi.mocked(method).mock.calls.map(([value]) => JSON.parse(String(value))));
}

describe("Control operational logging", () => {
  it("correlates handled server errors with the real H3 response without leaking request secrets", async () => {
    vi.stubEnv("TALI_ACCESS_LOG_ENABLED", "true");
    const server = app().get("/api/v1/access-context", () => errorResponse(
      Object.assign(new Error("upstream password=HIDDEN_PASSWORD"), { status: 503 }),
    ));
    const response = await server.fetch(new Request("http://localhost/api/v1/access-context?token=HIDDEN_QUERY", {
      headers: { "x-request-id": "HIDDEN_HEADER", cookie: "session=HIDDEN_COOKIE" },
    }));
    expect(response.status).toBe(503);
    const access = records().find((r) => r.event === "http.access");
    const failure = records().find((r) => r.event === "http.handler_failed");
    expect(access).toMatchObject({ level: "error", route: "access-context", status: 503,
      requestId: response.headers.get("x-request-id"), errorId: failure.errorId });
    expect(response.headers.get("x-control-error-id")).toBe(failure.errorId);
    expect(access.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(records())).not.toMatch(/HIDDEN_/);
  });

  it("keeps failures observable when successful access logging is disabled", async () => {
    vi.stubEnv("TALI_ACCESS_LOG_ENABLED", "false");
    const server = app().get("/ok", () => new Response("ok"))
      .get("/denied", () => new Response(null, { status: 403 }))
      .get("/broken", () => { throw new Error("database connection failed password=HIDDEN_PASSWORD"); });
    await server.fetch(new Request("http://localhost/ok"));
    await server.fetch(new Request("http://localhost/denied"));
    const broken = await server.fetch(new Request("http://localhost/broken"));
    expect(records().filter((r) => r.event === "http.access").map((r) => r.status)).toEqual([403, 500]);
    expect(records().find((r) => r.event === "runtime.error")).toMatchObject({
      requestId: broken.headers.get("x-request-id"), errorMessage: "database connection failed [REDACTED]",
    });
  });

  it("records proxy disagreement without blocking an allowlisted browser write", async () => {
    const config = developmentControlConfig();
    config.server.public_urls = ["https://relay.example.com"];
    config.server.trust_proxy_headers = true;
    setControlConfigForTests(config);
    const server = app().use(originGuard)
      .put("/api/v1/access-context", () => new Response(null, { status: 204 }));
    const response = await server.fetch(new Request("http://internal/api/v1/access-context", {
      method: "PUT",
      headers: { origin: "https://relay.example.com", cookie: "session=HIDDEN_COOKIE" },
    }));
    expect(response.status).toBe(204);
    expect(records().find((r) => r.event === "control_origin_proxy_mismatch")).toMatchObject({
      requestId: response.headers.get("x-request-id"),
      trustProxyHeaders: true,
      level: "warning",
      reason: "host_not_allowed",
    });
    expect(records().find((r) => r.event === "control.started")).toMatchObject({
      allowedOrigins: ["https://relay.example.com"], trustProxyHeaders: true,
    });
  });

  it("links origin rejection diagnostics to access logs", async () => {
    const server = app().use(originGuard);
    const response = await server.fetch(new Request("https://relay.example.com/api/v1/access-context", {
      method: "PUT",
      headers: { origin: "https://evil.example.com", cookie: "session=HIDDEN_COOKIE" },
    }));
    expect(response.status).toBe(403);
    expect(records().find((r) => r.event === "control_origin_rejected")).toMatchObject({
      requestId: response.headers.get("x-request-id"),
      reason: "origin_not_allowed",
      level: "warning",
    });
  });

  it("isolates IDs across concurrent requests", async () => {
    vi.stubEnv("TALI_ACCESS_LOG_ENABLED", "true");
    const server = app().get("/api/v1/access-context", async () => {
      await Promise.resolve();
      return new Response("ok");
    });
    const responses = await Promise.all(Array.from({ length: 5 }, () =>
      server.fetch(new Request("http://localhost/api/v1/access-context"))));
    const ids = responses.map((r) => r.headers.get("x-request-id"));
    expect(new Set(ids).size).toBe(5);
    expect(records().filter((r) => r.event === "http.access").map((r) => r.requestId).sort())
      .toEqual(ids.sort());
  });

  it("does not break immutable redirect responses", async () => {
    const response = await app().get("/redirect", () => Response.redirect("https://example.com"))
      .fetch(new Request("http://localhost/redirect"));
    expect(response.status).toBe(302);
  });
});


it.each(["uncaughtException", "unhandledRejection", "plugin"])(
  "marks process-level %s failures Critical without escalating request failures", (tag) => {
    const hooks: Partial<NitroRuntimeHooks> = {};
    app(hooks);
    hooks.error?.(new Error("process failure"), { tags: [tag] });
    hooks.error?.(new Error("request failure"), { tags: ["request"] });
    expect(records().filter((r) => r.event === "runtime.error").map((r) => r.level))
      .toEqual(["critical", "error"]);
  },
);

it("records invalid startup configuration as Critical", () => {
  setControlConfigForTests(undefined);
  vi.stubEnv("TALI_CONFIG", "/nonexistent-control-test.toml");
  expect(() => app()).toThrow("Unable to read");
  expect(records().find((r) => r.event === "control.configuration_failed"))
    .toMatchObject({ level: "critical" });
});
