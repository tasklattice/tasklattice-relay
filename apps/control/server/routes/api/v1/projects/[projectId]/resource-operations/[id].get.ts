import { defineHandler } from "nitro";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";
import { ProjectService } from "../../../../../../projects/project-service";
import { ResourceOperationService } from "../../../../../../projects/resource-operation-service";
export default defineHandler(async (event) => {
  try {
    const { projectId, userId, activeRole } = await new ProjectService().resolve(event.req);
    return jsonResponse(await new ResourceOperationService().get(projectId, event.context.params?.id ?? "", userId, activeRole === "admin"));
  } catch (error) { return errorResponse(error); }
});
