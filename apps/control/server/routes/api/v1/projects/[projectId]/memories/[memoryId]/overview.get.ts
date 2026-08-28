import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../../http/responses";
import { memoryIdFromParams } from "../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../services";

export default defineHandler(async (event) => {
  try { await requireAuth(event.req); } catch (error) { return unauthorizedResponse(error); }
  try {
    const memoryId = memoryIdFromParams(event.context.params);
    const service = await getMemoryService(event.req);
    const [memory, recentActivity, learned] = await Promise.all([
      service.getResource(memoryId),
      service.listActivity(memoryId, 20),
      service.listInsights({ memoryId, limit: 5, status: "active" }),
    ]);
    return jsonResponse({ memory, recentActivity, learnedInsights: learned.items });
  } catch (error) {
    return errorResponse(error);
  }
});
