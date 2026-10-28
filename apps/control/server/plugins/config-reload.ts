import { definePlugin } from "nitro";
import { invalidateAuthInstances } from "../auth/better-auth";
import {
  controlConfigPath,
  reloadControlConfig,
  type ControlConfigReloadResult,
} from "../config/control-config";
import { createStructuredLogger } from "../observability/structured-logger";

const logger = createStructuredLogger("control");

/**
 * A mounted Secret updates in place, so nothing restarts the Pod when the
 * operator fixes `control.toml`. Poll the file and adopt the runtime-safe
 * sections, which keeps the origin contract and the proxy settings of the
 * running process identical to the mounted file without a rollout.
 */
export const controlConfigPollIntervalMs = 10_000;

/** Identity of one outcome, so an unchanged file is logged once, not every poll. */
function signatureOf(result: ControlConfigReloadResult): string {
  switch (result.state) {
    case "applied":
      return `applied:${result.revision}`;
    case "invalid":
      return `invalid:${result.error}`;
    case "deferred":
      return `deferred:${result.requiresRestart.join(",")}`;
    default:
      return "unchanged";
  }
}

function logOutcome(result: ControlConfigReloadResult): void {
  if (result.state === "applied") {
    logger.log("info", "control.configuration_reloaded", {
      changed: result.changed,
      revision: result.revision,
    });
    // Better Auth instances are built per request origin from the old values.
    invalidateAuthInstances();
    return;
  }
  if (result.state === "invalid") {
    logger.log("error", "control.configuration_reload_invalid", {
      error: result.error,
      revision: result.revision,
    });
    return;
  }
  if (result.state === "deferred") {
    logger.log("warning", "control.configuration_reload_deferred", {
      changed: result.changed,
      requiresRestart: result.requiresRestart,
      revision: result.revision,
      hint: "Restart the Control Deployment to apply sections outside [server].",
    });
  }
}

export default definePlugin((nitro) => {
  if (!controlConfigPath()) return;
  let reported = "unchanged";
  const timer = setInterval(() => {
    let signature: string;
    try {
      const result = reloadControlConfig();
      signature = signatureOf(result);
      if (signature === reported) return;
      reported = signature;
      logOutcome(result);
    } catch (error) {
      signature = `failed:${error instanceof Error ? error.message : "unknown"}`;
      if (signature === reported) return;
      reported = signature;
      logger.log("error", "control.configuration_reload_failed", {
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }, controlConfigPollIntervalMs);
  timer.unref?.();
  nitro.hooks.hook("close", () => clearInterval(timer));
});
