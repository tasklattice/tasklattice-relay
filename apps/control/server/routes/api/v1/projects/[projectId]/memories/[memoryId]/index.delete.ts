import { memoryDeleteInputSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../../http/responses";
import { memoryIdFromParams } from "../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../services";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const memoryId = memoryIdFromParams(event.context.params);
    const input = memoryDeleteInputSchema.parse(await event.req.json());
    const service = await getMemoryService(event.req);
    const current = await service.getResource(memoryId);
    if (input.confirmation !== current.displayName) {
      throw new Error("The Memory name confirmation does not match.");
    }
    await service.consumeOperationBudget({
      action: "delete",
      actorId,
      limit: 3,
      memoryId,
      windowMs: 15 * 60_000,
    });
    const deleted = await service.delete(memoryId, actorId);
    return jsonResponse({ id: deleted.id, status: deleted.status });
  } catch (error) {
    return errorResponse(error);
  }
});
