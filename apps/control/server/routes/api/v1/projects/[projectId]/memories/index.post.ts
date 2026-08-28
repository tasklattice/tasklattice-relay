import { memoryCreateInputSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";
import { assertDurableMemoryAvailableForProject } from "../../../../../../memories/durable-memory-feature";
import { requiredIdempotencyKey } from "../../../../../../memories/memory-http";
import { getMemoryService, getProjectStore } from "../../../../../../services";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const input = memoryCreateInputSchema.parse(await event.req.json());
    const store = await getProjectStore(event.req);
    await assertDurableMemoryAvailableForProject(store.projectId, store);
    const service = await getMemoryService(event.req);
    const memory = await service.provision({
      actorId,
      displayName: input.displayName,
      idempotencyKey: `memory-api:${requiredIdempotencyKey(event.req)}`,
      ...(input.retentionPolicy ? { retentionPolicy: input.retentionPolicy } : {}),
    });
    return jsonResponse(await service.getResource(memory.id), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
});
