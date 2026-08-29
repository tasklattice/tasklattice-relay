import { defineHandler } from "nitro";
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
    const providerId = event.context.params?.providerId;
    if (!providerId)
      return problemResponse(400, "Provider id is required.");
    const connection = await (
      await getProviderService(event.req)
    ).revalidateAccount(providerId);
    if (!connection)
      return problemResponse(404, "Saved Provider not found.");
    return jsonResponse(connection);
  } catch (error) {
    return errorResponse(error);
  }
});
