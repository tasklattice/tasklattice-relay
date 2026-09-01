import { expertAgentDefinitionInputSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { ExpertAgentLifecycleService } from "../../../../../../../expert-agents/expert-agent-lifecycle-service";
import { errorResponse, jsonResponse } from "../../../../../../../http/responses";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const agent = await new ExpertAgentLifecycleService().updateAgent({
      projectId: decodeURIComponent(event.context.params?.projectId ?? ""),
      agentId: decodeURIComponent(event.context.params?.agentId ?? ""),
      actorId,
      definition: expertAgentDefinitionInputSchema.parse(await event.req.json()),
    });
    return jsonResponse(agent);
  } catch (error) { return errorResponse(error); }
});
