import { memoryConversationActionInputSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../../../../http/responses";
import { memoryIdFromParams } from "../../../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../../../services";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const conversationId = decodeURIComponent(event.context.params?.conversationId ?? "");
    if (!conversationId) throw new Error("A Memory Conversation ID is required.");
    const input = memoryConversationActionInputSchema.parse(await event.req.json());
    return jsonResponse(await (await getMemoryService(event.req)).deleteConversation({
      actorId,
      conversationId,
      idempotencyKey: input.idempotencyKey,
      memoryId: memoryIdFromParams(event.context.params),
    }));
  } catch (error) {
    return errorResponse(error);
  }
});
