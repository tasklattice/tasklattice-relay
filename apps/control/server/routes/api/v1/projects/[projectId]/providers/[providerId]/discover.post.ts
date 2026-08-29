import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../http/responses";
import {
  getProviderService,
  requireProjectRole,
} from "../../../../../../../services";

export default defineHandler(async (event) => {
  try {
    await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    await requireProjectRole(event.req, ["admin"]);
    const providerId = event.context.params?.providerId;
    if (!providerId) {
      return problemResponse(400, "Provider id is required.");
    }
    const discovery = await (
      await getProviderService(event.req)
    ).discoverAccount(providerId);
    return discovery
      ? jsonResponse(discovery)
      : problemResponse(404, "Saved Provider not found.");
  } catch (error) {
    return errorResponse(error);
  }
});
