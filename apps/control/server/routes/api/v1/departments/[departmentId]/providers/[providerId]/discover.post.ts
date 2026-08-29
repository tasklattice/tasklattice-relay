import { defineHandler } from "nitro";
import { requireAuth, unauthorizedResponse } from "../../../../../../../auth/auth";
import { getDepartmentInferenceServices } from "../../../../../../../departments/department-inference-service";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../http/responses";

export default defineHandler(async (event) => {
  let auth;
  try { auth = await requireAuth(event.req); } catch (error) { return unauthorizedResponse(error); }
  try {
    const services = await getDepartmentInferenceServices(auth, event.context.params?.departmentId ?? "", true);
    const result = await services.provider.discoverAccount(decodeURIComponent(event.context.params?.providerId ?? ""));
    return result ? jsonResponse(result) : problemResponse(404, "Saved Provider not found.");
  } catch (error) { return errorResponse(error); }
});
