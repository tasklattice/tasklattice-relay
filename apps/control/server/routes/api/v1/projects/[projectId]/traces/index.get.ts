import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";
import { ExpertAgentTraceRepository } from "../../../../../../traces/expert-agent-trace-repository";

export default defineHandler(async (event) => {
  try {
    await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }

  try {
    const auth = await requireAuth(event.req);
    const projectId = decodeURIComponent(event.context.params?.projectId ?? "");
    const repository = new ExpertAgentTraceRepository(
      projectId,
      auth.user.id,
      undefined,
      false,
    );
    return jsonResponse({ data: await repository.list(), source: "otel" });
  } catch (error) {
    return errorResponse(error);
  }
});
