import { defineHandler } from "nitro";
import { errorResponse, jsonResponse, problemResponse } from "../../../../../../../../../http/responses";
import { requireProjectRuntimeBridge, requireProjectRuntimeExpertAgent } from "../../../../../../../../../runtime-bridge/project-runtime-bridge-auth";
import { ExpertAgentRunTelemetryService } from "../../../../../../../../../runtime-bridge/expert-agent-run-telemetry-service";

export default defineHandler(async (event) => {
  const agentId = decodeURIComponent(event.context.params?.agentId ?? "");
  const versionId = decodeURIComponent(event.context.params?.versionId ?? "");
  let identity;
  try {
    const bridge = await requireProjectRuntimeBridge(event.req);
    identity = await requireProjectRuntimeExpertAgent(event.req, bridge, { agentId, versionId });
  } catch (error) { return problemResponse(401, error instanceof Error ? error.message : "Unauthorized."); }
  try {
    await new ExpertAgentRunTelemetryService(identity).ingest(await event.req.json());
    return jsonResponse({ result: null });
  } catch (error) { return errorResponse(error); }
});
