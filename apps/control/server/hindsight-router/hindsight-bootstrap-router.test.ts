import { describe, expect, it, vi } from "vitest";
import { HindsightBootstrapRouter } from "./hindsight-bootstrap-router";

const bankId = `tali_${"a".repeat(40)}`;

function router(requestFetch = vi.fn<typeof fetch>()) {
  return new HindsightBootstrapRouter({
    controlBaseUrl: "http://control:8080",
    controlToken: "control-token",
    embeddingDimensions: 4,
    routerToken: "router-token",
    fetch: requestFetch,
  });
}

function inferenceRequest(path: string, body: unknown, token = "router-token"): Request {
  return new Request(`http://router${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("HindsightBootstrapRouter", () => {
  it("serves deterministic bootstrap embeddings without contacting Control", async () => {
    const requestFetch = vi.fn<typeof fetch>();
    const subject = router(requestFetch);
    const first = await subject.handle(inferenceRequest("/embeddings", {
      model: "hindsight-embedding",
      input: ["probe", "probe-2"],
    }));
    const second = await subject.handle(inferenceRequest("/embeddings", {
      model: "hindsight-embedding",
      input: ["probe", "probe-2"],
    }));

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    const body = await subject.handle(inferenceRequest("/embeddings", { input: "probe" }));
    expect(((await body.json()) as { data: Array<{ embedding: number[] }> }).data[0]?.embedding).toHaveLength(4);
    expect(requestFetch).not.toHaveBeenCalled();
  });

  it("locks unscoped mock inference when Hindsight is ready and reopens for a container restart", async () => {
    const subject = router();
    subject.setHindsightReady(true);
    expect((await subject.handle(inferenceRequest("/chat/completions", { messages: [] }))).status).toBe(409);
    subject.setHindsightReady(false);
    expect((await subject.handle(inferenceRequest("/chat/completions", { messages: [] }))).status).toBe(200);
  });

  it("always forwards a valid Bank request with only the dedicated Control token", async () => {
    const requestFetch = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ choices: [] }),
      { headers: { "content-type": "application/json" } },
    ));
    const subject = router(requestFetch);
    subject.setHindsightReady(false);
    const response = await subject.handle(inferenceRequest("/v1/chat/completions", {
      model: "hindsight-chat",
      messages: [],
      user: bankId,
    }));

    expect(response.status).toBe(200);
    expect(requestFetch).toHaveBeenCalledOnce();
    const [url, init] = requestFetch.mock.calls[0]!;
    expect(url).toBe("http://control:8080/api/internal/hindsight/inference/chat");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer control-token");
    expect(new Headers(init?.headers).get("x-hindsight-bank-id")).toBe(bankId);
    expect(JSON.parse(String(init?.body))).toMatchObject({ user: bankId });
  });

  it("rejects bad credentials and explicit invalid Bank identifiers", async () => {
    const subject = router();
    expect((await subject.handle(inferenceRequest("/embeddings", {}, "wrong"))).status).toBe(401);
    expect((await subject.handle(inferenceRequest("/embeddings", { user: "another-project" }))).status).toBe(400);
  });
});
