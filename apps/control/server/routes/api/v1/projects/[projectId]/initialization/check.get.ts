import { defineHandler } from "nitro";
import { errorResponse, jsonResponse } from "../../../../../../http/responses";
import { ProjectService } from "../../../../../../projects/project-service";
import { ProjectNamespaceCheckService } from "../../../../../../projects/project-namespace-check";

export default defineHandler(async (event) => {
  try {
    const service = new ProjectService();
    const { projectId, userId } = await service.resolve(event.req);
    await service.requireRole(projectId, userId, ["admin"]);
    return jsonResponse(await new ProjectNamespaceCheckService().check(projectId), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) { return errorResponse(error); }
});
