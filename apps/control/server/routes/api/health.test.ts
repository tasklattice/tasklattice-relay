import { afterEach, describe, expect, it } from "vitest";
import { developmentControlConfig, setControlConfigForTests } from "../../config/control-config";
import health from "./health.get";

const handler = health as unknown as
  (event: { req: Request }) => Promise<Response>;

function probe(base = "http://10.0.0.5:8080") {
  return handler({ req: new Request(`${base}/api/health`, { headers: { host: new URL(base).host } }) });
}

describe("health origin diagnostics", () => {
  afterEach(() => setControlConfigForTests(undefined));

  it("reports how the probe itself resolved next to the static contract", async () => {
    const config = developmentControlConfig();
    config.server.public_urls = ["https://relay.example.com"];
    config.server.trust_proxy_headers = true;
    setControlConfigForTests(config);
    const body = await (await probe("https://relay.example.com")).json();
    // Database reachability is covered elsewhere; only the origin contract is
    // asserted here.
    expect(body.origin).toMatchObject({
      allowedOrigins: ["https://relay.example.com"],
      state: "ok",
      trustProxyHeaders: true,
      thisRequest: { host: "relay.example.com", origin: "https://relay.example.com", resolved: true },
    });
  });

  it("flags a plaintext Service probe instead of pretending the Pod address is public", async () => {
    const config = developmentControlConfig();
    config.server.public_urls = ["https://relay.example.com"];
    config.server.trust_proxy_headers = false;
    setControlConfigForTests(config);
    const body = await (await probe()).json();
    expect(body.origin).toMatchObject({
      state: "suspicious",
      trustProxyHeaders: false,
      thisRequest: { host: "10.0.0.5:8080", reason: "host_not_allowed", resolved: false },
    });
    expect(body.origin.hint).toMatch(/trust_proxy_headers/);
  });
});
