import { defineHandler } from "nitro";
import { problemResponse } from "../../../../../../../http/responses";
import { proxyHindsightRuntime } from "../../../../../../../runtime-bridge/project-hindsight-runtime";
import { requireProjectRuntimeBridge, requireProjectRuntimeCoordinator } from "../../../../../../../runtime-bridge/project-runtime-bridge-auth";

export default defineHandler(async (event) => {
  try {
    const bridge = await requireProjectRuntimeBridge(event.req);
    const identity = await requireProjectRuntimeCoordinator(event.req, bridge, event.context.params?.coordinatorInstanceId ?? "");
    return await proxyHindsightRuntime(event.req, identity, event.context.params?.path ?? "");
  } catch {
    // Authentication, feature gate, binding and Bank failures share one opaque
    // response. No upstream errors or credentials enter the public error log.
    return problemResponse(403, "Memory Runtime access denied.");
  }
});
