import { defineHandler } from "nitro";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";
import { ProjectService } from "../../../../../../projects/project-service";
import { ProjectRuntimeStatusService } from "../../../../../../projects/project-runtime-status";

export default defineHandler(async (event) => {
  try {
    const service = new ProjectService();
    const { projectId, userId } = await service.resolve(event.req);
    await service.requireRole(projectId, userId, ["admin"]);
    return jsonResponse(await new ProjectRuntimeStatusService().retry(projectId), { status: 202 });
  } catch (error) { return errorResponse(error); }
});
