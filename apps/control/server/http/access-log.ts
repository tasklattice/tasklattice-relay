const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

// Never emit a supplied path, query, header or error text. Even malformed and
// encoded capability URLs are safe because only fixed route categories leave
// this boundary. Business audit records provide the authorized resource IDs.
export function accessLogRecord(request: Request, status: number, startedAt: number, websocket = false) {
  let route = "control";
  try {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/_agent-ui/")) route = "agent-ui-proxy";
    else if (/^\/[^/]+\/[^/]+\/ui(?:\/|$)/.test(path)) route = "agent-ui-document";
    else if (path === "/api/health") route = "health";
    else if (path === "/api/v1/access-context") route = "access-context";
    else if (path === "/api/auth/sign-in/username") route = "auth-sign-in";
    else if (path.startsWith("/api/auth/")) route = "auth";
    else if (path.startsWith("/api/v1/platform/")) route = "platform-api";
    else if (path.startsWith("/api/v1/projects/")) route = "project-api";
    else if (path.startsWith("/api/v1/departments/")) route = "department-api";
    else if (path.startsWith("/api/internal/")) route = "internal-api";
    else if (path.startsWith("/api/v1/")) route = "control-api";
  } catch { route = "invalid"; }
  return {
    event: "http.access",
    method: methods.has(request.method) ? request.method : "OTHER",
    route,
    transport: websocket ? "websocket" : "http",
    status,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}
