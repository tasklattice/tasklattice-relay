import { describe, expect, it } from "vitest";
import { observedOpenShellPhase } from "./sandbox-state.js";

describe("OpenShell runtime recovery", () => {
  it("observes a recovered runtime after a cached failure", () => {
    expect(observedOpenShellPhase("Ready", { phase: "FAILED" })).toBe("READY");
    expect(observedOpenShellPhase("Provisioning", { phase: "FAILED" })).toBe("PROVISIONING");
  });

  it("preserves failed creation until a runtime exists", () => {
    expect(observedOpenShellPhase(undefined, { phase: "FAILED" })).toBe("FAILED");
    expect(observedOpenShellPhase(undefined, { phase: "READY" })).toBe("NOT_FOUND");
  });

  it("reports a new failure after the runtime was ready", () => {
    expect(observedOpenShellPhase("Error", { phase: "READY" })).toBe("FAILED");
  });
});
