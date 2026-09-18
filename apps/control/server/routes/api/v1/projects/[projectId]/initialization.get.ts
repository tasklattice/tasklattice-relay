import { defineHandler } from "nitro";
import { errorResponse, jsonResponse } from "../../../../../http/responses";
import { ProjectService } from "../../../../../projects/project-service";
import { ProjectRuntimeStatusService } from "../../../../../projects/project-runtime-status";

export default defineHandler(async (event) => {
  try {
    const { projectId } = await new ProjectService().resolve(event.req);
    return jsonResponse(await new ProjectRuntimeStatusService().get(projectId));
  } catch (error) { return errorResponse(error); }
});
