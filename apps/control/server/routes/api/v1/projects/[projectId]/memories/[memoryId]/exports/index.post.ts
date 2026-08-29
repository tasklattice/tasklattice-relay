import { memoryExportRequestInputSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../../../http/responses";
import { signMemoryExportToken } from "../../../../../../../../memories/memory-export-token";
import { memoryIdFromParams } from "../../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../../services";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    memoryExportRequestInputSchema.parse(await event.req.json());
    const memoryId = memoryIdFromParams(event.context.params);
    const projectId = decodeURIComponent(event.context.params?.projectId ?? "");
    if (!projectId) throw new Error("A Project ID is required.");
    const grant = signMemoryExportToken({ actorId, memoryId, projectId });
    const url = new URL(event.req.url);
    const downloadUrl = `${url.pathname}/${encodeURIComponent(grant.token)}`;
    const service = await getMemoryService(event.req);
    await service.consumeOperationBudget({
      action: "export",
      actorId,
      limit: 3,
      memoryId,
      windowMs: 5 * 60_000,
    });
    await service.recordExportGrant(
      memoryId,
      actorId,
      grant.expiresAt,
    );
    return jsonResponse({ downloadUrl, expiresAt: grant.expiresAt }, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
});
