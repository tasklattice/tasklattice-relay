import { defineHandler } from "nitro";
import { modelParamsSchema } from "../../../../../../../api-contracts/schemas";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../http/responses";
import { getProviderService, requireProjectRole } from "../../../../../../../services";

export default defineHandler(async (event) => {
  try {
    await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    await requireProjectRole(event.req, ["admin"]);
    const { modelId } = modelParamsSchema.parse(event.context.params);
    const impact = await (await getProviderService(event.req))
      .modelRemovalImpact(modelId);
    return impact
      ? jsonResponse(impact)
      : problemResponse(404, "Model deployment not found.");
  } catch (error) {
    return errorResponse(error);
  }
});
