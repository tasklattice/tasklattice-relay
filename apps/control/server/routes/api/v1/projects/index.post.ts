import { defineHandler } from "nitro";
import { createProjectInputSchema } from "../../../../api-contracts/schemas";
import { requireAuth, unauthorizedResponse } from "../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../http/responses";
import { ProjectService } from "../../../../projects/project-service";
import { requireProjectCreateCapability } from "../../../../services";

export default defineHandler(async (event) => {
  let auth;
  try { auth = await requireAuth(event.req); } catch (error) { return unauthorizedResponse(error); }
  try {
    const input = createProjectInputSchema.parse(await event.req.json());
    await requireProjectCreateCapability(event.req, input.departmentId);
    const service = new ProjectService();
    return jsonResponse(
      await service.create(
        auth,
        input.departmentId,
        input.name,
        input.invitations,
        "department",
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
});
