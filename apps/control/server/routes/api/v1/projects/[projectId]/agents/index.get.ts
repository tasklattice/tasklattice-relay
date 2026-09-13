import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../auth/auth";
import { ExpertAgentDeveloperService } from "../../../../../../expert-agents/expert-agent-developer-service";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";

export default defineHandler(async (event) => {
  try {
    const actorId = (await requireAuth(event.req)).user.id;
    const projectId = decodeURIComponent(event.context.params?.projectId ?? "");
    return jsonResponse({ data: await new ExpertAgentDeveloperService().list(projectId, actorId) });
  } catch (error) {
    return error instanceof Error && error.message.includes("Authentication")
      ? unauthorizedResponse(error)
      : errorResponse(error);
  }
});
