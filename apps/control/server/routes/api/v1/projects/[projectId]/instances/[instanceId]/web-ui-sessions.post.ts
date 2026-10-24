import { defineHandler } from "nitro";
import { createAgentUiSession } from "../../../../../../../agent-ui/access";
import { errorResponse, jsonResponse } from "../../../../../../../http/responses";
export default defineHandler(async (event) => {
  try {
    const { projectId = "", instanceId = "" } = event.context.params ?? {};
    return jsonResponse(await createAgentUiSession(event.req, projectId, instanceId), { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { return error instanceof Response ? error : errorResponse(error); }
});
