import { defineHandler } from "nitro";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../http/responses";
import {
  memoryRuntimeRecallInputSchema,
  MemoryRuntimeAccessDeniedError,
  ProjectMemoryRuntimeService,
} from "../../../../../../../runtime-bridge/project-memory-runtime-service";
import {
  requireProjectRuntimeBridge,
  requireProjectRuntimeCoordinator,
} from "../../../../../../../runtime-bridge/project-runtime-bridge-auth";

export default defineHandler(async (event) => {
  const coordinatorInstanceId = decodeURIComponent(
    event.context.params?.coordinatorInstanceId ?? "",
  );
  try {
    const bridge = await requireProjectRuntimeBridge(event.req);
    const identity = await requireProjectRuntimeCoordinator(
      event.req,
      bridge,
      coordinatorInstanceId,
    );
    const input = memoryRuntimeRecallInputSchema.parse(await event.req.json());
    return jsonResponse(
      await new ProjectMemoryRuntimeService(bridge.projectId).recall(
        identity,
        input,
      ),
    );
  } catch (error) {
    if (error instanceof MemoryRuntimeAccessDeniedError) {
      return problemResponse(403, "Memory Runtime access denied.");
    }
    // Authentication and scoped-binding failures deliberately share one
    // response so callers cannot probe Project, Instance, or Memory existence.
    if (error instanceof Error && /Runtime (?:Bridge|Coordinator)/.test(error.message)) {
      return problemResponse(403, "Memory Runtime access denied.");
    }
    return errorResponse(error);
  }
});
