import { defineHandler } from "nitro";
import { renewAgentUiSession } from "../../../../../../../agent-ui/access";
import { errorResponse, jsonResponse } from "../../../../../../../http/responses";
export default defineHandler(async (event) => {
  try {
    const { projectId = "", instanceId = "" } = event.context.params ?? {};
    return jsonResponse(await renewAgentUiSession(event.req, projectId, instanceId), { headers: { "cache-control": "no-store" } });
  } catch (error) { return error instanceof Response ? error : errorResponse(error); }
});
