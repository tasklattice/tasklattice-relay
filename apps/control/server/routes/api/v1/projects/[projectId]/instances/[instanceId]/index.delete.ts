import { defineHandler } from "nitro";
import { instanceParamsSchema } from "../../../../../../../api-contracts/schemas";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../http/responses";
import { getInstanceService } from "../../../../../../../services";

export default defineHandler(async (event) => {
  try {
    await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    const { instanceId: id } = instanceParamsSchema.parse(event.context.params);
    const service = await getInstanceService(event.req);
    const instance = await service.get(id);
    const retainedMemory = instance?.durableMemoryId
      ? await service.memories.getResource(instance.durableMemoryId).then((memory) => ({
          id: memory.id,
          displayName: memory.displayName,
          status: memory.status,
        })).catch(() => null)
      : null;
    const destroyed = await service.destroy(id);
    return destroyed
      ? jsonResponse(
          { id, status: "DESTROYING", accepted: true, retainedMemory },
          { status: 202 },
        )
      : problemResponse(404, "Instance not found.");
  } catch (error) {
    return errorResponse(error);
  }
});
