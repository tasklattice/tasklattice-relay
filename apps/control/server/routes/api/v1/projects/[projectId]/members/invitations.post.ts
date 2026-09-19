import { requestOrigin } from "../../../../../../http/request-origin";
import { defineHandler } from "nitro";
import { projectInvitationInputSchema } from "../../../../../../api-contracts/schemas";
import { unauthorizedResponse } from "../../../../../../auth/auth";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";
import { ProjectService } from "../../../../../../projects/project-service";

export default defineHandler(async (event) => {
  const service = new ProjectService();
  try {
    const { userId } = await service.authenticate(event.req);
    const input = projectInvitationInputSchema.parse(await event.req.json());
    return jsonResponse(await service.invite(
      decodeURIComponent(event.context.params?.projectId ?? ""),
      userId,
      input.email,
      input.role,
      requestOrigin(event.req),
    ), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("authentication")) return unauthorizedResponse(error);
    return errorResponse(error);
  }
});
