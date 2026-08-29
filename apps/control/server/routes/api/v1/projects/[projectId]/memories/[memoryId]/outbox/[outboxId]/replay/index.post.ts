import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../../../../auth/auth";
import { errorResponse, noContentResponse } from "../../../../../../../../../../http/responses";
import { memoryIdFromParams } from "../../../../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../../../../services";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const outboxId = decodeURIComponent(event.context.params?.outboxId ?? "");
    if (!outboxId) throw new Error("A Memory outbox event ID is required.");
    const service = await getMemoryService(event.req);
    const memoryId = memoryIdFromParams(event.context.params);
    await service.consumeOperationBudget({
      action: "outbox_replay",
      actorId,
      limit: 10,
      memoryId,
      windowMs: 60_000,
    });
    await service.replayOutbox(
      memoryId, outboxId, actorId,
    );
    return noContentResponse();
  } catch (error) {
    return errorResponse(error);
  }
});
