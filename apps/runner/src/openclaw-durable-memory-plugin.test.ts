import { afterEach, describe, expect, it, vi } from "vitest";
import {
  finalAssistantText,
  memoryRequest,
  stableConversationId,
  toolSummaries,
} from "../../../runtime-integrations/openclaw-durable-memory/client.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("OpenClaw Durable Memory integration", () => {
  it("extracts bounded assistant and tool content from OpenClaw messages", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "first" }] },
      { role: "tool", name: "search", content: [{ type: "text", text: "evidence" }] },
      { role: "assistant", content: [{ type: "text", text: "final answer" }] },
    ];
    expect(finalAssistantText(messages)).toBe("final answer");
    expect(toolSummaries(messages)).toEqual(["search: evidence"]);
  });

  it("uses the stable OpenClaw run id and deterministic fallback for retain idempotency", () => {
    expect(stableConversationId({
      runId: "run-a",
      sessionKey: "session-a",
      prompt: "hello",
      assistant: "hi",
    })).toBe("run-a");
    const input = {
      sessionKey: "session-a",
      prompt: "hello",
      assistant: "hi",
    };
    expect(stableConversationId(input)).toBe(stableConversationId(input));
  });

  it("calls only the pre-scoped Gateway operation and never accepts a Bank selector", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      context: "bounded context",
      degraded: false,
      itemCount: 1,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    await expect(memoryRequest(
      "http://runtime-bridge.svc.cluster.local/v1/memory/coordinators/agent-a",
      "scoped-token",
      "recall",
      { query: "release", maxItems: 6 },
      1_800,
    )).resolves.toMatchObject({ itemCount: 1 });

    expect(fetch).toHaveBeenCalledWith(
      "http://runtime-bridge.svc.cluster.local/v1/memory/coordinators/agent-a/recall",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "release", maxItems: 6 }),
      }),
    );
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("bankId");
  });
});
