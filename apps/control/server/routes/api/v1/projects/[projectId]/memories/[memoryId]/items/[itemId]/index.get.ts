import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../../../../http/responses";
import { memoryIdFromParams } from "../../../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../../../services";

export default defineHandler(async (event) => {
  try { await requireAuth(event.req); } catch (error) { return unauthorizedResponse(error); }
  try {
    const itemId = decodeURIComponent(event.context.params?.itemId ?? "");
    if (!itemId) throw new Error("A Memory item ID is required.");
    return jsonResponse(await (await getMemoryService(event.req)).getItem(
      memoryIdFromParams(event.context.params),
      itemId,
    ));
  } catch (error) {
    return errorResponse(error);
  }
});
