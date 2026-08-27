import { createInstanceSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";
import { getInstanceService } from "../../../../../../services";
import { instanceConfigurationView } from "../../../../../../instances/instance-http-view";

export default defineHandler(async (event) => {
  let actorId: string;
  try {
    actorId = (await requireAuth(event.req)).user.id;
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    const input = createInstanceSchema.parse(await event.req.json());
    const idempotencyKey = event.req.headers.get("idempotency-key")?.trim();
    const agent = await (await getInstanceService(event.req)).create(
      input,
      actorId,
      idempotencyKey || undefined,
    );
    return jsonResponse(instanceConfigurationView(agent), {
      status: 202,
      headers: { location: `/api/v1/projects/${encodeURIComponent(event.context.params?.projectId ?? "")}/instances/${agent.id}` },
    });
  } catch (error) {
    return errorResponse(error);
  }
});
