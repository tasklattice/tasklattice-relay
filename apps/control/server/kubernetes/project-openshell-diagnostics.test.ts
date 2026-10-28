import { afterEach, describe, expect, it, vi } from "vitest";
import { startGatewayDiagnostics } from "./project-openshell-diagnostics";
import { defaultCommandRunner } from "./project-openshell-gateway-client";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("OpenShell install diagnostics", () => {
  it("retains pre-rollback resources and does not confuse an old same-name Job with this attempt", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const reader = vi.fn()
      .mockResolvedValueOnce([{ kind: "Job", name: "gateway-certgen", uid: "old", createdAt: new Date(0), jobDeadlineExceeded: true, details: {} }])
      .mockResolvedValueOnce([{ kind: "Pod", name: "broken", uid: "pod", details: { reason: "FailedScheduling" } }])
      .mockResolvedValue([]);
    const stop = startGatewayDiagnostics("tp-example", "attempt", reader, "gateway-certgen");
    await vi.advanceTimersByTimeAsync(2100);
    const report = await stop();
    expect(report.deadlineExceeded).toBe(false);
    expect(report.snapshots).toEqual(expect.arrayContaining([expect.objectContaining({ name: "broken", uid: "pod" })]));
    const count = reader.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(reader).toHaveBeenCalledTimes(count);
  });

  it("recognizes a current certgen deadline and tolerates collector failures", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const reader = vi.fn().mockImplementationOnce(async () => [{ kind: "Job", name: "gateway-certgen", uid: "new",
      createdAt: new Date(Date.now() + 1000), jobDeadlineExceeded: true, details: {} }]).mockRejectedValue(new Error("API unavailable"));
    const stop = startGatewayDiagnostics("tp-example", "attempt", reader, "gateway-certgen");
    const report = await stop();
    expect(report.deadlineExceeded).toBe(true);
    expect(report.snapshots).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "DiagnosticUnavailable" })]));
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const result = await defaultCommandRunner({ command: process.execPath,
      args: ["-e", 'process.on("SIGTERM", () => console.log("ignored")); setInterval(() => {}, 1000);'],
      timeoutMs: 500,
    });
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toContain("ignored");
  }, 15000);

  it("waits for SIGTERM handling and child close before returning timeout", async () => {
    const result = await defaultCommandRunner({ command: process.execPath,
      args: ["-e", 'process.on("SIGTERM", () => setTimeout(() => { console.log("terminated"); process.exit(0); }, 100)); setInterval(() => {}, 1000);'],
      timeoutMs: 500,
    });
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toContain("terminated");
    expect(result.stderr).toContain("Helm command timed out after 500ms");
  });
});

describe("image pull error classification", () => {
  it.each([
    ["unauthorized: bearer SUPER-SECRET", "registry-authentication-failed"],
    ["denied: password=SUPER-SECRET", "registry-access-denied"],
    ["manifest unknown", "image-or-tag-not-found"],
    ["x509: certificate signed by unknown authority", "registry-certificate-error"],
    ["dial tcp: no such host", "registry-network-error"],
    ["unrecognized secret=SUPER-SECRET", undefined],
  ])("classifies without retaining raw response: %s", async (message, expected) => {
    const { imagePullFailure } = await import("./project-openshell-diagnostics");
    expect(imagePullFailure(message)).toBe(expected);
  });
});


it("warns once per collector outage and reports recovery without dumping API errors", async () => {
  vi.useFakeTimers();
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const reader = vi.fn().mockRejectedValueOnce(new Error("HIDDEN_API_BODY"))
    .mockRejectedValueOnce(new Error("HIDDEN_API_BODY"))
    .mockResolvedValue([]);
  const stop = startGatewayDiagnostics("tp-example", "attempt", reader, "certgen");
  await vi.advanceTimersByTimeAsync(4100);
  await stop();
  expect(warning).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(warning.mock.calls[0]?.[0])))
    .toMatchObject({ level: "warning", event: "openshell.diagnostics_unavailable" });
  expect(info.mock.calls.map(([value]) => JSON.parse(String(value))))
    .toContainEqual(expect.objectContaining({ level: "info", event: "openshell.diagnostics_recovered" }));
  expect(JSON.stringify(warning.mock.calls)).not.toContain("HIDDEN");
});
