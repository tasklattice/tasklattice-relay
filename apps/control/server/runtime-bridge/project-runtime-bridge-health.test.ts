import express from "express";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { registerRuntimeBridgeHealth } from "./project-runtime-bridge-health";

const servers: Server[] = [];

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function bridge(controlUrl: string): Promise<string> {
  const app = express();
  registerRuntimeBridgeHealth(app, { controlUrl, projectId: "project-a" });
  return listen(app);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

describe("Runtime Bridge health", () => {
  it("preserves legacy liveness during an image-first upgrade without contacting Control", async () => {
    let calls = 0;
    const control = await listen((_request, response) => {
      calls++;
      response.writeHead(503);
      response.end();
    });
    const url = await bridge(control);
    for (const path of ["/healthz", "/livez"]) {
      const response = await fetch(url + path);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, projectId: "project-a" });
    }
    expect(calls).toBe(0);
    expect((await fetch(`${url}/readyz`)).status).toBe(503);
    expect(calls).toBe(1);
  });

  it("checks Control health without sending credentials and recovers after an outage", async () => {
    let healthy = true;
    const requests: Array<{ url: string | undefined; authorization: string | undefined }> = [];
    const control = await listen((request, response) => {
      requests.push({ url: request.url, authorization: request.headers.authorization });
      response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: healthy }));
    });
    const url = await bridge(`${control}/`);
    for (const available of [true, false, true]) {
      healthy = available;
      const response = await fetch(`${url}/readyz`);
      expect(response.status).toBe(available ? 200 : 503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ ok: available, control: { ok: available } });
    }
    expect(requests).toEqual(Array(3).fill({ url: "/api/health", authorization: undefined }));
  });

  it.each([
    [503, '{"ok":false,"message":"private database details"}', "http_error"],
    [200, '{"ok":false}', "invalid_response"],
    [200, '<html>login</html>', "invalid_response"],
    [200, '{}', "invalid_response"],
  ])("rejects unhealthy or unexpected Control responses (%s, %s)", async (status, body, reason) => {
    const control = await listen((_request, response) => {
      response.writeHead(status);
      response.end(body);
    });
    const url = await bridge(control);
    const response = await fetch(`${url}/readyz`);
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result).toMatchObject({ ok: false, control: { ok: false, reason } });
    expect(JSON.stringify(result)).not.toContain("private database details");
  });

  it("does not follow redirects", async () => {
    let redirected = false;
    const control = await listen((request, response) => {
      if (request.url === "/api/health") {
        response.writeHead(302, { location: "/login" });
        response.end();
      } else {
        redirected = true;
        response.end('{"ok":true}');
      }
    });
    const response = await fetch(`${await bridge(control)}/readyz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ control: { reason: "http_error", status: 302 } });
    expect(redirected).toBe(false);
  });

  it("marks connection failures unready while keeping liveness independent", async () => {
    const control = await listen((_request, response) => response.destroy());
    const url = await bridge(control);
    const response = await fetch(`${url}/readyz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ control: { reason: "unreachable" } });
    const alive = await fetch(`${url}/livez`);
    expect(alive.status).toBe(200);
    expect(await alive.json()).toMatchObject({ ok: true, projectId: "project-a" });
    const legacy = await fetch(`${url}/healthz`);
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toMatchObject({ ok: true, projectId: "project-a" });
  });

  it.each([false, true])("bounds stalled Control requests, including response bodies (headers=%s)", async (sendHeaders) => {
    const control = await listen((_request, response) => {
      if (sendHeaders) {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"ok":');
      }
    });
    const url = await bridge(control);
    const pending = fetch(`${url}/readyz`);
    // Liveness remains responsive even while the readiness request is blocked.
    expect((await fetch(`${url}/livez`)).status).toBe(200);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ control: { reason: "timeout" } });
  });
});
