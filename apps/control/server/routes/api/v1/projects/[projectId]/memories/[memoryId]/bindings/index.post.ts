import { memoryBindingCreateInputSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../../../http/responses";
import { memoryIdFromParams, requiredIdempotencyKey } from "../../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../../services";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const input = memoryBindingCreateInputSchema.parse(await event.req.json());
    return jsonResponse(await (await getMemoryService(event.req)).attachExisting({
      actorId,
      idempotencyKey: requiredIdempotencyKey(event.req),
      instanceId: input.instanceId,
      memoryId: memoryIdFromParams(event.context.params),
      runtimeType: input.runtimeType,
    }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
});
