import { expertAgentDraftTryInputSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../auth/auth";
import { ExpertAgentDraftTryService } from "../../../../../../expert-agents/expert-agent-draft-try-service";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    return jsonResponse(await new ExpertAgentDraftTryService().run({
      actorId,
      projectId: decodeURIComponent(event.context.params?.projectId ?? ""),
      value: expertAgentDraftTryInputSchema.parse(await event.req.json()),
    }));
  } catch (error) { return errorResponse(error); }
});
