import { createInstanceLogSessionSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { instanceParamsSchema } from "../../../../../../../api-contracts/schemas";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../http/responses";
import { getAgentInstanceDetailService } from "../../../../../../../services";
import { createAgentLogSession } from "../../../../../../../terminal/agent-log-sessions";

export default defineHandler(async (event) => {
  try {
    await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    const { instanceId } = instanceParamsSchema.parse(event.context.params);
    const input = createInstanceLogSessionSchema.parse(await event.req.json());
    const service = await getAgentInstanceDetailService(event.req);
    const detail = await service.get(instanceId);
    if (!detail) return problemResponse(404, "Instance not found.");
    if (
      (detail.kind !== "A2A" && detail.kind !== "PROJECT_AGENT")
      || !detail.capabilities.liveLogs
    ) {
      return problemResponse(409, "Live Pod logs are not available for this Agent runtime.");
    }
    if (
      detail.status !== "READY"
      || (!detail.instance.podName && !detail.runtimeView.workloadName)
    ) {
      return problemResponse(409, "Live logs are available only when the managed Agent runtime is ready.");
    }
    return jsonResponse(
      createAgentLogSession(service.garden.projectId, instanceId, input),
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
});
