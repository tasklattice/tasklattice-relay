import { ResourceOperationService } from "../../../../../../../projects/resource-operation-service";
import { onboardAgentSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import {
  requireAuth,
  unauthorizedResponse,
} from "../../../../../../../auth/auth";
import {
  errorResponse,
  jsonResponse,
} from "../../../../../../../http/responses";
import {
  getAgentGardenService,
  requireProjectRole,
} from "../../../../../../../services";

export default defineHandler(async (event) => {
  let actorId: string;
  try {
    actorId = (await requireAuth(event.req)).user.id;
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    await requireProjectRole(event.req, ["admin"]);
    const input = onboardAgentSchema.parse(await event.req.json());
    const service = await getAgentGardenService(event.req);
    const accepted = await new ResourceOperationService().enqueue(service.store.projectId, actorId, "onboard", input);
    return jsonResponse(accepted, { status: 202, headers: { location: accepted.statusUrl } });
  } catch (error) {
    return errorResponse(error);
  }
});
