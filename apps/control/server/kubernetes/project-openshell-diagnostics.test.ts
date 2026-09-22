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
