import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { NodeRequest } from "srvx/node";
import {
  developmentControlConfig,
  setControlConfigForTests,
} from "../config/control-config";
import {
  originContract,
  requestOrigin,
  resolveBrowserOrigin,
  sameOriginCallback,
} from "./request-origin";

describe("browser origin resolution", () => {
  beforeEach(() => {
    const config = developmentControlConfig();
    config.server.public_urls = [
      "http://localhost:38080",
      "https://relay.example.com",
    ];
    setControlConfigForTests(config);
  });
  afterEach(() => setControlConfigForTests(undefined));

  it("uses the actual allowed origin, independent of list order", () => {
    expect(requestOrigin(new Request("https://relay.example.com/login"))).toBe(
      "https://relay.example.com",
    );
    expect(requestOrigin(new Request("http://localhost:38080/login"))).toBe(
      "http://localhost:38080",
    );
  });

  it("handles Nitro Node requests behind TLS termination without consuming the request", () => {
    const config = developmentControlConfig();
    config.server.public_urls = ["https://relay.example.com"];
    config.server.trust_proxy_headers = true;
    setControlConfigForTests(config);
    const socket = new Socket();
    try {
      const incoming = new IncomingMessage(socket);
      incoming.method = "PUT";
      incoming.url = "/api/v1/access-context";
      incoming.headers = {
        host: "relay.example.com",
        origin: "https://relay.example.com",
        cookie: "session=test-session",
        "x-forwarded-host": "relay.example.com",
        "x-forwarded-proto": "https",
      };
      incoming.rawHeaders = Object.entries(incoming.headers).flat() as string[];
      const request = new NodeRequest({ req: incoming });
      expect(request.url).toBe("http://relay.example.com/api/v1/access-context");
      expect(requestOrigin(request)).toBe("https://relay.example.com");
      expect(request.bodyUsed).toBe(false);
    } finally {
      socket.destroy();
    }
  });

  it("classifies how the resolved origin failed instead of one opaque error", () => {
    // A host we do not serve is the caller's problem.
    expect(resolveBrowserOrigin(new Request("https://attacker.example/login"))).toMatchObject({
      ok: false,
      reason: "host_not_allowed",
    });
    // Our host, but the scheme we resolved is not configured: an operator fault.
    expect(resolveBrowserOrigin(new Request("http://relay.example.com/login"))).toMatchObject({
      ok: false,
      reason: "origin_unverifiable",
      resolvedOrigin: "http://relay.example.com",
    });
    expect(resolveBrowserOrigin(new Request("http://localhost:3000/login"))).toMatchObject({
      ok: false,
      reason: "origin_unverifiable",
    });
  });

  it("maps a failed resolution to the status owned by the failing side", () => {
    const unknownHost = (() => {
      try { return requestOrigin(new Request("https://attacker.example/login")); }
      catch (error) { return error; }
    })();
    expect(unknownHost).toMatchObject({ status: 403, code: "CONTROL_ORIGIN_FORBIDDEN" });

    const unverifiable = (() => {
      try { return requestOrigin(new Request("http://relay.example.com/login")); }
      catch (error) { return error; }
    })();
    expect(unverifiable).toMatchObject({ status: 503, code: "CONTROL_ORIGIN_CONFIGURATION_ERROR" });
  });

  it("ignores forwarded headers unless explicitly trusted", () => {
    const request = new Request("http://localhost:38080/login", {
      headers: {
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
      },
    });
    expect(requestOrigin(request)).toBe("http://localhost:38080");
    const config = developmentControlConfig();
    config.server.public_urls = ["https://relay.example.com"];
    config.server.trust_proxy_headers = true;
    setControlConfigForTests(config);
    // Resolution stays strict; the single configured public URL wins for tasks
    // that need an absolute URL, and never from the spoofable header.
    expect(resolveBrowserOrigin(request)).toMatchObject({ ok: false, reason: "host_not_allowed" });
    expect(requestOrigin(request)).toBe("https://relay.example.com");
    const proxied = new Request("http://control.tali.svc:38080/login", {
      headers: {
        "x-forwarded-host": "relay.example.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(requestOrigin(proxied)).toBe("https://relay.example.com");
  });

  it("falls back to an allowlisted Origin or Referer before the single public URL", () => {
    const config = developmentControlConfig();
    config.server.public_urls = ["https://relay.example.com", "https://relay.alt.example.com"];
    setControlConfigForTests(config);
    const unresolvable = (headers: Record<string, string>) => new Request(
      "http://control.internal:8080/api/auth/sso",
      { headers },
    );
    expect(requestOrigin(unresolvable({ origin: "https://relay.example.com" })))
      .toBe("https://relay.example.com");
    expect(requestOrigin(unresolvable({ referer: "https://relay.alt.example.com/access" })))
      .toBe("https://relay.alt.example.com");
    // A value outside the allowlist is never used, and ambiguity still fails.
    expect(() => requestOrigin(unresolvable({ origin: "https://evil.example.com" }))).toThrow(
      "Request origin is not in server.public_urls",
    );
    expect(() => requestOrigin(unresolvable({ origin: "null" }))).toThrow();
  });

  it("diagnoses TLS termination and accepts the public origin with trusted proxy headers", () => {
    const config = developmentControlConfig();
    config.server.public_urls = ["https://relay.example.com:8443"];
    setControlConfigForTests(config);
    const request = new Request("http://control.tali.svc:8080/api/auth/sign-in/username", {
      headers: {
        host: "relay.example.com:8443",
        "x-forwarded-host": "relay.example.com:8443",
        "x-forwarded-proto": "https",
      },
    });

    expect(resolveBrowserOrigin(request)).toMatchObject({
      ok: false,
      reason: "origin_unverifiable",
      resolvedOrigin: "http://relay.example.com:8443",
    });
    // One configured public URL leaves nothing to guess: callers that need an
    // absolute URL still get it instead of failing the whole request.
    expect(requestOrigin(request)).toBe("https://relay.example.com:8443");

    config.server.trust_proxy_headers = true;
    expect(requestOrigin(request)).toBe("https://relay.example.com:8443");

    // Trust alone cannot recover the public scheme when the proxy omits it.
    request.headers.delete("x-forwarded-proto");
    expect(resolveBrowserOrigin(request)).toMatchObject({
      ok: false,
      resolvedOrigin: "http://relay.example.com:8443",
    });
  });

  it("preserves local paths and rejects external or backslash callbacks", () => {
    const origin = "https://relay.example.com";
    expect(sameOriginCallback("/project?tab=agents#active", origin)).toBe(
      `${origin}/project?tab=agents#active`,
    );
    for (const value of [
      "//attacker.example",
      "/\\attacker.example",
      "https://attacker.example",
      "javascript:alert(1)",
    ]) {
      expect(sameOriginCallback(value, origin)).toBe(`${origin}/`);
    }
  });
});

describe("origin configuration contract", () => {
  afterEach(() => setControlConfigForTests(undefined));

  it("flags an HTTPS allowlist that ignores forwarded headers before the first write", () => {
    const config = developmentControlConfig();
    config.server.public_urls = ["https://relay.example.com"];
    config.server.trust_proxy_headers = false;
    setControlConfigForTests(config);
    expect(originContract()).toMatchObject({
      state: "suspicious",
      trustProxyHeaders: false,
      allowedOrigins: ["https://relay.example.com"],
    });
    expect(originContract().hint).toMatch(/trust_proxy_headers/);
  });

  it("accepts plaintext development origins and trusted proxy deployments", () => {
    const config = developmentControlConfig();
    config.server.public_urls = ["http://localhost:5173"];
    setControlConfigForTests(config);
    expect(originContract().state).toBe("ok");

    config.server.public_urls = ["https://relay.example.com"];
    config.server.trust_proxy_headers = true;
    expect(originContract().state).toBe("ok");
  });
});
