import { defineHandler } from "nitro";
import { instanceParamsSchema } from "../../../../../../../api-contracts/schemas";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../http/responses";
import { getAgentInstanceDetailService } from "../../../../../../../services";
import { a2aInstanceConfigurationView, agentServiceInstanceConfigurationView, instanceConfigurationView } from "../../../../../../../instances/instance-http-view";

export default defineHandler(async (event) => {
  try {
    await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    const { instanceId } = instanceParamsSchema.parse(event.context.params);
    const detail = await (
      await getAgentInstanceDetailService(event.req)
    ).get(instanceId);
    const response = detail?.kind === "SUPERVISOR"
      ? { ...detail, instance: instanceConfigurationView(detail.instance) }
      : detail?.kind === "A2A"
        ? { ...detail, instance: a2aInstanceConfigurationView(detail.instance) }
        : detail?.kind === "PROJECT_AGENT"
          ? {
              ...detail,
              instance: agentServiceInstanceConfigurationView(detail.instance),
            }
        : detail;
    return response
      ? jsonResponse(response)
      : problemResponse(404, "Instance not found.");
  } catch (error) {
    return errorResponse(error);
  }
});
