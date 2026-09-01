import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { traceParamsSchema } from "../../../../../../../api-contracts/schemas";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../http/responses";
import { ExpertAgentTraceRepository } from "../../../../../../../traces/expert-agent-trace-repository";

export default defineHandler(async (event) => {
  try {
    await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }

  try {
    const auth = await requireAuth(event.req);
    const { traceId } = traceParamsSchema.parse(event.context.params);
    const repository = new ExpertAgentTraceRepository(
      decodeURIComponent(event.context.params?.projectId ?? ""),
      auth.user.id,
      undefined,
      auth.accessContext?.roleId === "ROLE_AGENT_DEVELOPER",
    );
    const trace = await repository.getById(traceId);
    return trace
      ? jsonResponse(trace)
      : problemResponse(404, "Trace not found.");
  } catch (error) {
    return errorResponse(error);
  }
});
