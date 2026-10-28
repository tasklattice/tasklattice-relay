/**
 * One table for every request class that crosses the browser boundary.
 *
 * The guard must not guess from "does this request carry a cookie": a
 * token-authenticated route that also receives a stale cookie would be blocked
 * for the wrong reason, and an opaque-origin Agent document needs the opposite
 * answer. Paths are classified here once.
 */
export interface OriginRule {
  /** Same-origin browser writes need the cookie CSRF check. */
  cookieCsrf: boolean;
  /** `Origin: null` is legitimate for Agent documents proxied by Control. */
  opaqueOrigin: "allow" | "deny";
}

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function underPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isSafeMethod(method: string): boolean {
  return safeMethods.has(method.toUpperCase());
}

export function originRule(method: string, pathname: string): OriginRule {
  // Agent documents are served with an opaque origin by design; the dedicated
  // proxy validates the capability credential instead of Control cookies.
  if (pathname.startsWith("/_agent-ui/")) return { cookieCsrf: false, opaqueOrigin: "allow" };
  // Service-to-service and probe surfaces authenticate with their own token.
  if (
    underPath(pathname, "/api/health")
    || underPath(pathname, "/api/metrics")
    || underPath(pathname, "/api/v1/runtime-bridge")
  ) {
    return { cookieCsrf: false, opaqueOrigin: "allow" };
  }
  if (isSafeMethod(method)) return { cookieCsrf: false, opaqueOrigin: "deny" };
  return { cookieCsrf: true, opaqueOrigin: "deny" };
}
