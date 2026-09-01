import { defineHandler } from "nitro";
import { z } from "zod";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { ExpertAgentLifecycleService } from "../../../../../../../expert-agents/expert-agent-lifecycle-service";
import { errorResponse, jsonResponse } from "../../../../../../../http/responses";

const schema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  publicationNotes: z.string().trim().max(8_000).nullable().default(null),
}).strict();

export default defineHandler(async (event) => {
  let actorId: string;
  try { actorId = (await requireAuth(event.req)).user.id; } catch (error) { return unauthorizedResponse(error); }
  try {
    const input = schema.parse(await event.req.json());
    const version = await new ExpertAgentLifecycleService().publishAgent({
      projectId: decodeURIComponent(event.context.params?.projectId ?? ""),
      agentId: decodeURIComponent(event.context.params?.agentId ?? ""),
      actorId,
      expectedRevision: input.expectedRevision,
      ...(input.publicationNotes ? { publicationNotes: input.publicationNotes } : {}),
    });
    return jsonResponse({
      id: version.id,
      agentId: version.agentId,
      versionNumber: version.versionNumber,
      sourceRevision: version.sourceRevision,
      contentDigest: version.contentDigest,
      manifestDigest: version.manifestDigest,
      artifactSetDigest: version.artifactSetDigest,
      publicationNotes: version.releaseNotes,
      gardenStatus: version.gardenStatus,
      publishedBy: version.publishedBy,
      publishedAt: version.publishedAt.toISOString(),
    }, { status: 201 });
  } catch (error) { return errorResponse(error); }
});
