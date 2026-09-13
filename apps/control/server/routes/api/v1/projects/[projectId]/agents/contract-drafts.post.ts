import { defineHandler } from "nitro";
import { z } from "zod";
import { requireAuth, unauthorizedResponse } from "../../../../../../auth/auth";
import { ExpertAgentContractDraftService } from "../../../../../../expert-agents/expert-agent-contract-draft-service";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";

const schema = z.object({ intention: z.string().trim().min(20).max(12_000) }).strict();

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const { intention } = schema.parse(await event.req.json());
    return jsonResponse(await new ExpertAgentContractDraftService().draft({
      actorId,
      projectId: decodeURIComponent(event.context.params?.projectId ?? ""),
      intention,
    }));
  } catch (error) { return errorResponse(error); }
});
