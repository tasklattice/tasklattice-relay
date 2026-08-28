import { memoryFactUpdateInputSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../../../../http/responses";
import { memoryIdFromParams } from "../../../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../../../services";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const itemId = decodeURIComponent(event.context.params?.itemId ?? "");
    if (!itemId) throw new Error("A Memory item ID is required.");
    return jsonResponse(await (await getMemoryService(event.req)).updateFact({
      actorId,
      itemId,
      memoryId: memoryIdFromParams(event.context.params),
      update: memoryFactUpdateInputSchema.parse(await event.req.json()),
    }));
  } catch (error) {
    return errorResponse(error);
  }
});
