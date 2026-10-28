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


describe("operational log diagnostics", () => {
  it("keeps UUIDs intact and serializes nested Error objects", () => {
    const output = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestId = "12345678-1234-4234-8234-123456789012";
    createStructuredLogger("control").log("warning", "test", {
      requestId, args: [new Error("connection refused")],
    });
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      requestId, args: [{ errorName: "Error", errorMessage: "connection refused" }],
    });
  });

  it("redacts multi-cookie headers, quoted passwords and HTTP URL credentials/query strings", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    createStructuredLogger("control").log("error", "test", {
      ...serializeError(new Error([
        "Cookie: first=HIDDEN_ONE; second=HIDDEN_TWO",
        'upstream {"password":"HIDDEN THREE"}',
        "https://user:HIDDEN_PASS@example.com/api?code=HIDDEN_CODE#HIDDEN_FRAGMENT",
      ].join("\n"))),
    });
    const text = String(output.mock.calls[0]?.[0]);
    expect(text).not.toContain("HIDDEN");
    expect(text).toContain("https://example.com/api");
    expect(text).toContain("errorStack");
  });
});


it("preserves dependency error codes and bounded, redacted causes", () => {
  const cause = Object.assign(new Error("password=HIDDEN"), { code: "ECONNREFUSED" });
  const error = new Error("database unavailable", { cause });
  cause.cause = error;
  const fields = serializeError(error);
  expect(fields).toMatchObject({ cause: { errorCode: "ECONNREFUSED" } });
  expect(JSON.stringify(fields)).not.toContain("HIDDEN");
});


it.each([
  ["critical", "error"], ["error", "error"], ["warning", "warn"], ["info", "info"],
] as const)("emits %s severity via console.%s with protected envelope fields", (level, method) => {
  const output = vi.spyOn(console, method).mockImplementation(() => undefined);
  createStructuredLogger("control", { level: "debug", component: "override" })
    .log(level, "test.event", { level: "debug", event: "override", password: "HIDDEN" });
  expect(output).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
    level, event: "test.event", component: "control", password: "[REDACTED]",
  });
});


it("does not throttle repeated request or job events through consola", () => {
  const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const logger = createStructuredLogger("control", { requestId: "12345678-1234-4234-8234-123456789012" });
  for (let i = 0; i < 12; i++) logger.log("info", "job.completed", { outcome: "ok" });
  expect(output).toHaveBeenCalledTimes(12);
  for (const [line] of output.mock.calls) {
    const record = JSON.parse(String(line));
    expect(record).toMatchObject({ level: "info", component: "control", event: "job.completed" });
    expect(Number.isNaN(Date.parse(record.timestamp))).toBe(false);
    expect(String(line)).not.toContain("\n");
  }
});

it("keeps component tags and fields isolated between consola child loggers", () => {
  const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const control = createStructuredLogger("control", { requestId: "request-a" });
  const worker = createStructuredLogger("control-worker", { jobId: "job-b" });
  control.log("info", "http.access");
  worker.log("info", "job.completed");
  const records = output.mock.calls.map(([line]) => JSON.parse(String(line)));
  expect(records[0]).toMatchObject({ component: "control", requestId: "request-a" });
  expect(records[0]).not.toHaveProperty("jobId");
  expect(records[1]).toMatchObject({ component: "control-worker", jobId: "job-b" });
  expect(records[1]).not.toHaveProperty("requestId");
});
