import { defineHandler } from "nitro";
import { agentUiUrl, createAgentUiSession } from "./access";
import { proxyAgentRequest } from "./proxy";

/** Serve the Agent's own document directly. CSP, not a wrapper iframe, isolates it. */
export default defineHandler(async (event) => {
  try {
    const { projectId = "", instanceId = "" } = event.context.params ?? {};
    const publicBase = agentUiUrl(projectId, instanceId);
    const source = new URL(event.req.url);
    const path = source.pathname.slice(publicBase.length);
    const session = await createAgentUiSession(event.req, projectId, instanceId, true);
    source.pathname = session.contentUrl + path;
    return await proxyAgentRequest(new Request(source, { signal: event.req.signal }), publicBase);
  } catch (error) {
    const status = error instanceof Response ? error.status : error && typeof error === "object" && "evidence" in error ? 403 : 502;
    return new Response("Agent Web UI unavailable. Return to Relay, check access and reopen this instance.", {
      status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
    });
  }
});
