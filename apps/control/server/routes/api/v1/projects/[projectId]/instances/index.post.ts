import { createInstanceSchema } from "@tali/contracts";
import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";
import { getInstanceService } from "../../../../../../services";

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
    const service = await getInstanceService(event.req);
    const agent = await service.create(
      input,
      actorId,
      idempotencyKey || undefined,
    );
    const operation = await service.lifecycle.latestForInstance(
      agent.id,
      "provision",
    );
    if (!operation) {
      throw new Error("Instance provisioning operation was not created.");
    }
    return jsonResponse({ instanceId: agent.id, operation }, {
      status: 202,
      headers: {
        location: `/api/v1/projects/${encodeURIComponent(event.context.params?.projectId ?? "")}/instances/${agent.id}/operations/${operation.id}`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
});
