import { ResourceOperationService } from "../../../../../../../../../projects/resource-operation-service";
import { defineHandler } from "nitro";
import { z } from "zod";
import {
  requireAuth,
  unauthorizedResponse,
} from "../../../../../../../../../auth/auth";
import {
  errorResponse,
  jsonResponse,
} from "../../../../../../../../../http/responses";
import {
  getAgentGardenService,
  requireProjectRole,
} from "../../../../../../../../../services";

export default defineHandler(async (event) => {
  let actorId: string;
  try {
    actorId = (await requireAuth(event.req)).user.id;
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    await requireProjectRole(event.req, ["admin", "developer"]);
    const id = decodeURIComponent(event.context.params?.id ?? "");
    const input = z.object({ versionId: z.string().uuid().optional() }).strict()
      .parse(await event.req.json());
    const service = await getAgentGardenService(event.req);
    const accepted = await new ResourceOperationService().enqueue(service.store.projectId, actorId, "instantiate", { id, versionId: input.versionId });
    return jsonResponse(accepted, { status: 202, headers: { location: accepted.statusUrl } });
  } catch (error) {
    return errorResponse(error);
  }
});
