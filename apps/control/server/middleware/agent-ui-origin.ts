import { defineMiddleware } from "nitro";
import { requestOrigin } from "../http/request-origin";

export default defineMiddleware((event) => {
  const request = event.req;
  if (new URL(request.url).pathname.startsWith("/_agent-ui/")) return;
  // Agent documents have an opaque origin and must never exercise Control cookies.
  const origin = request.headers.get("origin");
  if (origin === "null") return new Response("Control access from an isolated Agent is forbidden.", { status: 403 });
  if (origin && !["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.has("cookie")) {
    try { if (origin === requestOrigin(request)) return; } catch { /* fail closed */ }
    return new Response("Cross-origin Control request forbidden.", { status: 403 });
  }
});
