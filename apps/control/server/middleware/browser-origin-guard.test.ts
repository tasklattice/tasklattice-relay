import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { developmentControlConfig, setControlConfigForTests } from "../config/control-config";
import originGuard from "./browser-origin-guard";

const guard = originGuard as unknown as
  (event: { req: Request }) => Response | undefined;

interface RequestOptions {
  cookie?: boolean;
  headers?: Record<string, string>;
}

/** Simulates a browser write: same public host on both sides by default. */
function check(
  path: string,
  method: string,
  origin: string,
  options: RequestOptions = {},
  base = "https://relay.example.com",
): Response | undefined {
  return guard({
    req: new Request(`${base}${path}`, {
      method,
      headers: {
        host: new URL(base).host,
        origin,
        ...(options.cookie === false ? {} : { cookie: "control=login" }),
        ...options.headers,
      },
    }),
  });
}

async function problem(response: Response | undefined) {
  expect(response).toBeDefined();
  expect(response!.headers.get("content-type")).toContain("application/problem+json");
  return await response!.json() as Record<string, unknown>;
}

function logEntries() {
  return vi.mocked(console.warn).mock.calls.map(([value]) => JSON.parse(String(value)));
}

function lastWarning(event?: string) {
  return logEntries().filter((entry) => !event || entry.event === event).at(-1);
}

describe("browser origin guard", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = developmentControlConfig();
    config.server.public_urls = ["https://relay.example.com"];
    config.server.trust_proxy_headers = true;
    setControlConfigForTests(config);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setControlConfigForTests(undefined);
  });

  it("lets same-origin browser writes and every safe method through", () => {
    expect(check("/api/v1/access-context", "PUT", "https://relay.example.com")).toBeUndefined();
    expect(check("/api/v1/projects", "POST", "https://relay.example.com")).toBeUndefined();
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(check("/api/v1/access-context", method, "https://evil.test")).toBeUndefined();
    }
    expect(logEntries()).toEqual([]);
  });

  it("rejects a foreign browser origin as a denial", async () => {
    const body = await problem(check("/api/v1/access-context", "PUT", "https://evil.test"));
    expect(body).toMatchObject({
      type: "urn:tali:problem:CONTROL_ORIGIN_FORBIDDEN",
      title: "Access denied",
      status: 403,
      code: "CONTROL_ORIGIN_FORBIDDEN",
      detail: "Request origin is not allowed.",
      instance: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(lastWarning("control_origin_rejected")).toMatchObject({
      reason: "origin_not_allowed",
      browserOrigin: "https://evil.test",
      resolvedOrigin: "https://relay.example.com",
    });
  });

  it.each([
    {
      label: "internal host from the proxy",
      headers: { "x-forwarded-host": "control.internal:8080", "x-forwarded-proto": "https" },
      publicUrl: "https://relay.example.com",
      base: "http://control.internal:8080",
      reason: "host_not_allowed",
    },
    {
      label: "missing public scheme",
      headers: { "x-forwarded-host": "relay.example.com" },
      publicUrl: "https://relay.example.com",
      base: "http://relay.example.com",
      reason: "origin_unverifiable",
    },
    {
      label: "protocol chain",
      headers: { "x-forwarded-host": "relay.example.com:8443", "x-forwarded-proto": "https,http" },
      publicUrl: "https://relay.example.com:8443",
      base: "http://control.internal:8080",
      reason: "origin_unverifiable",
    },
    {
      label: "port only in X-Forwarded-Port",
      headers: {
        "x-forwarded-host": "relay.example.com",
        "x-forwarded-proto": "https",
        "x-forwarded-port": "8443",
      },
      publicUrl: "https://relay.example.com:8443",
      base: "http://control.internal:8080",
      reason: "origin_unverifiable",
    },
  ])("accepts an allowlisted Origin and only warns about the proxy: $label", (testCase) => {
    const config = developmentControlConfig();
    config.server.public_urls = [testCase.publicUrl];
    config.server.trust_proxy_headers = true;
    setControlConfigForTests(config);
    // The write must succeed: a proxy header mistake is not a permission fact.
    expect(check("/api/v1/access-context", "PUT", testCase.publicUrl, {
      headers: testCase.headers,
    }, testCase.base)).toBeUndefined();
    expect(lastWarning("control_origin_proxy_mismatch")).toMatchObject({
      reason: testCase.reason,
      browserOrigin: testCase.publicUrl,
      trustProxyHeaders: true,
      allowedOrigins: [testCase.publicUrl],
    });
    expect(logEntries().filter((entry) => entry.event === "control_origin_rejected")).toEqual([]);
  });

  it("never relies on the client IP for the cookie decision", () => {
    for (const clientIp of [null, "198.51.100.20", "198.51.100.20, 10.0.0.8"]) {
      expect(check("/api/v1/access-context", "PUT", "https://relay.example.com", {
        headers: {
          "x-forwarded-host": "relay.example.com",
          "x-forwarded-proto": "https",
          ...(clientIp ? { "x-forwarded-for": clientIp } : {}),
        },
      })).toBeUndefined();
      expect(check("/api/v1/access-context", "PUT", "https://different.example.com", {
        headers: { "x-forwarded-host": "relay.example.com", "x-forwarded-proto": "https" },
      })?.status).toBe(403);
    }
  });

  it("verifies local sign-in before a cookie exists", async () => {
    for (const cookie of [true, false]) {
      expect((await problem(check(
        "/api/auth/sign-in/username",
        "POST",
        "https://evil.test",
        { cookie },
      ))).status).toBe(403);
      expect(check("/api/auth/sign-in/username", "POST", "https://relay.example.com", { cookie }))
        .toBeUndefined();
    }
  });

  it("denies opaque-origin Control access but leaves the Agent surface to its own credential", () => {
    for (const path of ["/api/v1/projects", "/api/auth/sign-out", "/project/instance/ui/", "/_agent-ui-other/"]) {
      for (const method of ["GET", "POST"]) expect(check(path, method, "null")?.status).toBe(403);
    }
    expect(check("/_agent-ui/session/capability/", "POST", "null")).toBeUndefined();
  });

  it("leaves token-authenticated and probe surfaces outside the cookie CSRF rule", () => {
    for (const path of ["/api/metrics", "/api/v1/runtime-bridge/coordinators/x/memory/recall", "/api/health"]) {
      expect(check(path, "POST", "https://evil.test")).toBeUndefined();
    }
  });

  it("does not intercept a non-browser client that carries no Origin header", () => {
    expect(guard({ req: new Request("https://relay.example.com/api/v1/projects", {
      method: "POST",
      headers: { cookie: "control=login", authorization: "Bearer token" },
    }) })).toBeUndefined();
  });

  it("logs effective origin settings without logging credentials, query strings or bodies", async () => {
    await problem(check(
      "/api/v1/access-context?token=query-secret",
      "PUT",
      "https://evil.test",
      {
        headers: {
          authorization: "Bearer bearer-secret",
          "x-forwarded-host": "user:password-secret@relay.test",
          "x-forwarded-proto": "https,http",
        },
      },
    ));
    const entry = JSON.stringify(lastWarning("control_origin_rejected"));
    expect(JSON.parse(entry)).toMatchObject({
      reason: "origin_not_allowed",
      browserOrigin: "https://evil.test",
      forwardedHost: "invalid",
      forwardedProto: "https,http",
      trustProxyHeaders: true,
      allowedOrigins: ["https://relay.example.com"],
    });
    expect(entry).not.toMatch(/query-secret|cookie-secret|bearer-secret|password-secret|body-secret/);
  });
});
