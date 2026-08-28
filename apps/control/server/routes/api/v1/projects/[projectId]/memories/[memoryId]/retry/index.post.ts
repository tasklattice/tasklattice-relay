import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../../../http/responses";
import { memoryIdFromParams } from "../../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../../services";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    return jsonResponse(await (await getMemoryService(event.req)).retryProvisioning(
      memoryIdFromParams(event.context.params), actorId,
    ));
  } catch (error) {
    return errorResponse(error);
  }
});
