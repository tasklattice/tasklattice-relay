import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../../http/responses";
import { memoryIdFromParams } from "../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../services";

export default defineHandler(async (event) => {
  try { await requireAuth(event.req); } catch (error) { return unauthorizedResponse(error); }
  try {
    return jsonResponse({ items: await (await getMemoryService(event.req)).listActivity(
      memoryIdFromParams(event.context.params),
    ) });
  } catch (error) {
    return errorResponse(error);
  }
});
