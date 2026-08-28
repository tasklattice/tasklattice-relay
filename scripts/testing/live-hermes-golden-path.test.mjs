import assert from "node:assert/strict";
import test from "node:test";
import {
  RelayClient,
  cookieHeader,
  eventToolNames,
  stripAnsi,
  websocketUrl,
} from "./live-hermes-e2e-lib.mjs";

test("builds a scoped Hermes WebSocket URL without leaking the access token", () => {
  const url = websocketUrl(
    "https://sandbox.example/chat?access_token=secret",
    "/api/pty",
    { channel: "project-a", fresh: 1 },
  );
  assert.equal(url.protocol, "wss:");
  assert.equal(url.pathname, "/api/pty");
  assert.equal(url.searchParams.get("channel"), "project-a");
  assert.equal(url.searchParams.get("fresh"), "1");
  assert.equal(url.searchParams.has("access_token"), false);
});

test("extracts only cookie pairs from combined Set-Cookie headers", () => {
  const headers = new Headers({
    "set-cookie": "session=abc; Path=/; HttpOnly",
  });
  assert.equal(cookieHeader(headers), "session=abc");
});

test("normalizes terminal evidence and collects structured tool events", () => {
  assert.equal(stripAnsi("\u001b[32mready\u001b[0m\r\n"), "ready\n");
  assert.deepEqual(eventToolNames([
    { type: "tool.start", payload: { name: "a2a_list" } },
    { type: "message.delta", payload: { text: "x" } },
    { type: "tool.start", payload: { name: "vector_database_search" } },
  ]), ["a2a_list", "vector_database_search"]);
});

test("Relay client keeps authentication and project scope on JSON requests", async () => {
  const calls = [];
  const client = new RelayClient("https://relay.example", async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/sign-in/username")) {
      return new Response("{}", {
        status: 200,
        headers: { "set-cookie": "relay_session=signed; Path=/; HttpOnly" },
      });
    }
    return Response.json({ ok: true });
  });
  await client.login("admin", "password");
  await client.project("project/a", "/instances", {
    method: "POST",
    body: JSON.stringify({ name: "Hermes" }),
  });

  assert.equal(calls[1].url, "https://relay.example/api/v1/projects/project%2Fa/instances");
  const headers = new Headers(calls[1].init.headers);
  assert.equal(headers.get("cookie"), "relay_session=signed");
  assert.equal(headers.get("content-type"), "application/json");
});
