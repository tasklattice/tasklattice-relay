#!/usr/bin/env node
import { deleteDevelopmentRelease } from "./lib/delete-development-release.mjs";

const [context, namespace, release, timeout = "30m"] = process.argv.slice(2);
if (!context || !namespace || !release) throw new Error("Usage: delete-local.mjs CONTEXT NAMESPACE RELEASE [TIMEOUT]");
try {
  deleteDevelopmentRelease({ context, namespace, release, timeout });
} catch (error) {
  console.error(`Relay cleanup stopped: ${error.message}`);
  console.error("Resolve the reported error and rerun helm:delete:dev. No finalizers were forcibly removed.");
  process.exitCode = 1;
}
