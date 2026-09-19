import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  developmentControlConfig,
  setControlConfigForTests,
} from "../config/control-config";
import { requestOrigin, sameOriginCallback } from "./request-origin";

describe("request origin", () => {
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

  it("rejects unknown hosts, ports and downgraded schemes", () => {
    for (const url of [
      "https://attacker.example",
      "http://relay.example.com",
      "http://localhost:3000",
    ]) {
      expect(() => requestOrigin(new Request(url))).toThrow();
    }
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
    expect(() => requestOrigin(request)).toThrow();
    const proxied = new Request("http://control.tali.svc:38080/login", {
      headers: {
        "x-forwarded-host": "relay.example.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(requestOrigin(proxied)).toBe("https://relay.example.com");
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
