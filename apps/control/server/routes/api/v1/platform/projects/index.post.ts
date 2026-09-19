import { defineHandler } from "nitro";
import { createProjectInputSchema } from "../../../../../api-contracts/schemas";
import {
  requireAuth,
  requirePlatformAdministrator,
  unauthorizedResponse,
} from "../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../http/responses";
import { ProjectService } from "../../../../../projects/project-service";

export default defineHandler(async (event) => {
  try {
    await requireAuth(event.req);
  } catch (error) {
    return unauthorizedResponse(error);
  }
  try {
    const auth = await requirePlatformAdministrator(
      event.req,
      "CAP_PLATFORM_PROJECT_CREATE",
    );
    const input = createProjectInputSchema.parse(await event.req.json());
    return jsonResponse(
      await new ProjectService().create(
        auth,
        input.departmentId,
        input.name,
        input.invitations,
        "platform",
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
});
