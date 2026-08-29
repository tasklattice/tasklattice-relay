import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../../../http/responses";
import { memoryIdFromParams, memoryItemQuery } from "../../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../../services";

export default defineHandler(async (event) => {
  try { await requireAuth(event.req); } catch (error) { return unauthorizedResponse(error); }
  try {
    return jsonResponse(await (await getMemoryService(event.req)).listExperiences({
      memoryId: memoryIdFromParams(event.context.params),
      ...memoryItemQuery(event.req),
    }));
  } catch (error) {
    return errorResponse(error);
  }
});
