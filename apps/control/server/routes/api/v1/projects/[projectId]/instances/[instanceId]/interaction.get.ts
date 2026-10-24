import { defineHandler } from "nitro";
import { instanceParamsSchema } from "../../../../../../../api-contracts/schemas";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { instanceInteractionAccess } from "../../../../../../../instances/instance-http-view";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../http/responses";
import { getInstanceService } from "../../../../../../../services";
import { agentUiUrl } from "../../../../../../../agent-ui/access";

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
    const httpEndpoint =
      instance?.status === "READY" && instance.httpEndpoint?.status === "READY"
        ? { ...instance.httpEndpoint, url: agentUiUrl(service.store.projectId, instance.id) }
        : instance?.httpEndpoint;
    return instance
      ? jsonResponse(instanceInteractionAccess(instance, httpEndpoint), {
          headers: { "cache-control": "no-store" },
        })
      : problemResponse(404, "Instance not found.");
  } catch (error) {
    return errorResponse(error);
  }
});
