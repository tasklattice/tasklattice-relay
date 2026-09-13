import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { ExpertAgentTestService } from "../../../../../../../expert-agents/expert-agent-validation-service";
import { errorResponse, jsonResponse } from "../../../../../../../http/responses";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const projectId = decodeURIComponent(event.context.params?.projectId ?? "");
    return jsonResponse(await new ExpertAgentTestService(projectId).runPublishTest({
      agentId: decodeURIComponent(event.context.params?.agentId ?? ""),
      actorId,
    }), { status: 201 });
  } catch (error) { return errorResponse(error); }
});
