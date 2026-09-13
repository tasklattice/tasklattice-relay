import { expertAgentTryInputSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { ExpertAgentTestService } from "../../../../../../../expert-agents/expert-agent-validation-service";
import { errorResponse, jsonResponse } from "../../../../../../../http/responses";

export default defineHandler(async (event) => {
  let actorId: string;
  try {
    actorId = (await requireAuth(event.req)).user.id;
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    const projectId = decodeURIComponent(event.context.params?.projectId ?? "");
    const { message } = expertAgentTryInputSchema.parse(await event.req.json());
    return jsonResponse(await new ExpertAgentTestService(projectId).runDeveloperTry({
      agentId: decodeURIComponent(event.context.params?.agentId ?? ""),
      actorId,
      message,
    }));
  } catch (error) {
    return errorResponse(error);
  }
});
