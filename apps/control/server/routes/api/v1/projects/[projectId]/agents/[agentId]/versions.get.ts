import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { ExpertAgentDeveloperService } from "../../../../../../../expert-agents/expert-agent-developer-service";
import { errorResponse, jsonResponse } from "../../../../../../../http/responses";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const detail = await new ExpertAgentDeveloperService().detail(
      decodeURIComponent(event.context.params?.projectId ?? ""),
      decodeURIComponent(event.context.params?.agentId ?? ""),
      actorId,
    );
    return jsonResponse({ data: detail.versions });
  } catch (error) { return errorResponse(error); }
});
