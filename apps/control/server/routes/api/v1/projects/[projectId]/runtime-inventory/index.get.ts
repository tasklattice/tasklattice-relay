import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../auth/auth";
import { ownerFilterForCapability } from "../../../../../../authorization/authorization-context";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";
import { getRuntimeInventoryService } from "../../../../../../services";

export default defineHandler(async (event) => {
  try {
    await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    const service = await getRuntimeInventoryService(event.req);
    return jsonResponse(await service.list(
      ownerFilterForCapability(
        event.req,
        "CAP_AGENT_INSTANCE_CONFIG_VIEW",
      ),
    ));
  } catch (error) {
    return errorResponse(error);
  }
});
