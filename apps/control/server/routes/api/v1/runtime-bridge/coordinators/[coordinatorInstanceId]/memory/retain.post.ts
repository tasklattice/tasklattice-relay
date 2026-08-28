import { defineHandler } from "nitro";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../http/responses";
import {
  memoryRuntimeRetainInputSchema,
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
    const input = memoryRuntimeRetainInputSchema.parse(await event.req.json());
    return jsonResponse(
      await new ProjectMemoryRuntimeService(bridge.projectId).retain(
        identity,
        input,
      ),
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof MemoryRuntimeAccessDeniedError) {
      return problemResponse(403, "Memory Runtime access denied.");
    }
    if (error instanceof Error && /Runtime (?:Bridge|Coordinator)/.test(error.message)) {
      return problemResponse(403, "Memory Runtime access denied.");
    }
    return errorResponse(error);
  }
});
