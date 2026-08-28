import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../../../../http/responses";
import { memoryIdFromParams } from "../../../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../../../services";

export default defineHandler(async (event) => {
  try { await requireAuth(event.req); } catch (error) { return unauthorizedResponse(error); }
  try {
    const conversationId = decodeURIComponent(event.context.params?.conversationId ?? "");
    if (!conversationId) throw new Error("A Memory Conversation ID is required.");
    return jsonResponse(await (await getMemoryService(event.req)).getConversation(
      memoryIdFromParams(event.context.params), conversationId,
    ));
  } catch (error) {
    return errorResponse(error);
  }
});
