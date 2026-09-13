import { defineHandler } from "nitro";
import { z } from "zod";
import {
  requireAuth,
  unauthorizedResponse,
} from "../../../../../../../../../auth/auth";
import {
  errorResponse,
  jsonResponse,
} from "../../../../../../../../../http/responses";
import {
  getAgentGardenService,
  requireProjectRole,
} from "../../../../../../../../../services";

export default defineHandler(async (event) => {
  let actorId: string;
  try {
    actorId = (await requireAuth(event.req)).user.id;
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    await requireProjectRole(event.req, ["admin", "developer"]);
    const id = decodeURIComponent(event.context.params?.id ?? "");
    const input = z.object({ versionId: z.string().uuid().optional() }).strict()
      .parse(await event.req.json());
    const instance = await (
      await getAgentGardenService(event.req)
    ).instantiate(id, actorId, input.versionId);
    return jsonResponse(instance, {
      status: 201,
      headers: {
        location:
          `/api/v1/projects/${encodeURIComponent(
            event.context.params?.projectId ?? "",
          )}/instances/${encodeURIComponent(instance.id)}`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
});
