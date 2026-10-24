import { defineHandler } from "nitro";
import { proxyAgentRequest } from "../../agent-ui/proxy";

export default defineHandler(async (event) => {
  try { return await proxyAgentRequest(event.req); }
  catch (error) {
    return new Response(error instanceof Response ? await error.text() : "Agent access unavailable.", {
      status: error instanceof Response ? error.status : 403,
      headers: { "cache-control": "no-store", "content-type": "text/plain", "referrer-policy": "no-referrer" },
    });
  }
});
