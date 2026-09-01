import { defineHandler } from "nitro";
import { instanceParamsSchema } from "../../../../../../../api-contracts/schemas";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { a2aInstanceRuntimeLogView, instanceRuntimeLogView } from "../../../../../../../instances/instance-http-view";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../http/responses";
import { getAgentInstanceDetailService } from "../../../../../../../services";

export default defineHandler(async (event) => {
  try {
    await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    const { instanceId } = instanceParamsSchema.parse(event.context.params);
    const detail = await (await getAgentInstanceDetailService(event.req)).get(instanceId);
    const logs = detail?.kind === "SUPERVISOR"
      ? instanceRuntimeLogView(detail.instance)
      : detail?.kind === "A2A"
        ? a2aInstanceRuntimeLogView(detail.instance)
        : detail?.kind === "PROJECT_AGENT"
          ? a2aInstanceRuntimeLogView(detail.instance)
        : undefined;
    return logs
      ? jsonResponse(logs, {
          headers: { "cache-control": "no-store" },
        })
      : problemResponse(404, "Instance not found.");
  } catch (error) {
    return errorResponse(error);
  }
});
