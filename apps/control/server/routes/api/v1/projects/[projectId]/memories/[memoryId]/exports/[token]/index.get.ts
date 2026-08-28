import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../../../auth/auth";
import { errorResponse, problemResponse } from "../../../../../../../../../http/responses";
import { verifyMemoryExportToken } from "../../../../../../../../../memories/memory-export-token";
import { memoryIdFromParams } from "../../../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../../../services";

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160) || "memory-export";
}

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const memoryId = memoryIdFromParams(event.context.params);
    const projectId = decodeURIComponent(event.context.params?.projectId ?? "");
    const token = decodeURIComponent(event.context.params?.token ?? "");
    if (!projectId || !token) throw new Error("The Memory export authorization is invalid or expired.");
    verifyMemoryExportToken(token, { actorId, memoryId, projectId });
    const exported = await (await getMemoryService(event.req)).exportMemory(memoryId, actorId);
    const content = typeof exported.content === "string"
      ? exported.content
      : Buffer.from(exported.content);
    return new Response(content, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${safeFilename(exported.filename)}"`,
        "content-type": exported.contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("invalid or expired")) {
      return problemResponse(403, "The Memory export authorization is invalid or expired.", {
        code: "memory_export_authorization_invalid",
      });
    }
    return errorResponse(error);
  }
});
