import { afterEach, describe, expect, it, vi } from "vitest";
import { createStructuredLogger, serializeError } from "./structured-logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("structured logger secret exclusion", () => {
  it("redacts secret-shaped nested fields, messages, and error stacks", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createStructuredLogger("memory-worker", {
      authorization: "Bearer abcdefghijklmnop",
    });
    const error = new Error(
      "provider failed Authorization: Bearer abcdefghijklmnop postgres://user:pass@db/memory",
    );

    logger.log("error", "memory.retain_failed", {
      conversation: {
        text: "Cookie: session=super-secret-cookie",
      },
      ...serializeError(error),
    });

    const serialized = output.mock.calls[0]?.[0] as string;
    expect(serialized).toContain("memory.retain_failed");
    expect(serialized).toContain("[REDACTED]");
    for (const secret of [
      "abcdefghijklmnop",
      "postgres://user:pass",
      "super-secret-cookie",
    ]) {
      expect(serialized).not.toContain(secret);
      expect(JSON.stringify(serializeError(error))).not.toContain(secret);
    }
  });
});
