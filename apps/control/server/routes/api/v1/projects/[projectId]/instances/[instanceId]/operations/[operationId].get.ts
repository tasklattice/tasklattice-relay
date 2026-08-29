import { defineHandler } from "nitro";
import { instanceOperationParamsSchema } from "../../../../../../../../api-contracts/schemas";
import { requireAuth, unauthorizedResponse } from "../../../../../../../../auth/auth";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../../http/responses";
import { getInstanceService } from "../../../../../../../../services";

export default defineHandler(async (event) => {
  try {
    await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    const { instanceId, operationId } = instanceOperationParamsSchema.parse(
      event.context.params,
    );
    const service = await getInstanceService(event.req);
    const operation = await service.lifecycle.get(operationId);
    return operation?.instanceId === instanceId
      ? jsonResponse(operation, {
          headers: { "cache-control": "no-store" },
        })
      : problemResponse(404, "Instance lifecycle operation not found.");
  } catch (error) {
    return errorResponse(error);
  }
});
