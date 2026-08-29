import { memoryRenameInputSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../../http/responses";
import { memoryIdFromParams } from "../../../../../../../memories/memory-http";
import { getMemoryService } from "../../../../../../../services";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const input = memoryRenameInputSchema.parse(await event.req.json());
    return jsonResponse(await (await getMemoryService(event.req)).rename(
      memoryIdFromParams(event.context.params),
      input.displayName,
      actorId,
    ));
  } catch (error) {
    return errorResponse(error);
  }
});
