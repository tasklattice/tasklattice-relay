import type { RunnerSandbox } from "@tali/contracts";

export function observedOpenShellPhase(
  observed: string | undefined,
  previous: Pick<RunnerSandbox, "phase"> | undefined,
): RunnerSandbox["phase"] {
  // Preserve provisioning diagnostics when creation never reached OpenShell.
  // An existing runtime must be observed again, including after recovery.
  if (!observed) return previous?.phase === "FAILED" ? "FAILED" : "NOT_FOUND";
  const phase = observed.toLowerCase();
  if (phase === "ready") return "READY";
  if (phase === "error" || phase === "failed") return "FAILED";
  return "PROVISIONING";
}
