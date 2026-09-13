import { expertAgentDefinitionInputSchema, expertAgentExecutionModes } from "@tali/contracts";
import { defineHandler } from "nitro";
import { z } from "zod";
import { requireAuth, unauthorizedResponse } from "../../../../../../auth/auth";
import { ExpertAgentLifecycleService } from "../../../../../../expert-agents/expert-agent-lifecycle-service";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";

const inputSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(120),
  executionMode: z.enum(expertAgentExecutionModes),
  definition: expertAgentDefinitionInputSchema,
}).strict();

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const projectId = decodeURIComponent(event.context.params?.projectId ?? "");
    const input = inputSchema.parse(await event.req.json());
    const agent = await new ExpertAgentLifecycleService().createAgent({ projectId, actorId, ...input });
    return jsonResponse(agent, { status: 201 });
  } catch (error) { return errorResponse(error); }
});
