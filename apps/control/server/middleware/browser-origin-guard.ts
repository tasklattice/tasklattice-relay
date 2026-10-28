import { defineMiddleware } from "nitro";
import { getControlConfig } from "../config/control-config";
import { originRule } from "../http/route-origin-policy";
import {
  resolveBrowserOrigin,
  type OriginResolution,
} from "../http/request-origin";
import { problemResponse } from "../http/responses";
import { controlRequestId } from "../observability/request-diagnostics";
import { createStructuredLogger } from "../observability/structured-logger";

const logger = createStructuredLogger("control");

function diagnosticOrigin(value: string | null): string | null {
  if (value === null) return null;
  try { return new URL(value).origin; } catch { return "invalid"; }
}

function diagnosticProxyHeader(value: string | null): string | null {
  if (value === null) return null;
  // Retain comma-separated proxy chains for diagnosis, but never arbitrary
  // URL credentials, query strings or unbounded header content.
  return value.length <= 256 && /^[a-zA-Z0-9.:[\], _-]+$/.test(value)
    ? value : "invalid";
}

function proxyDiagnostics(request: Request, resolution: OriginResolution | null) {
  const server = getControlConfig().server;
  return {
    requestId: controlRequestId(request),
    method: request.method,
    browserOrigin: diagnosticOrigin(request.headers.get("origin")),
    requestOrigin: diagnosticOrigin(request.url),
    resolvedOrigin: resolution?.ok
      ? resolution.origin
      : resolution?.resolvedOrigin ?? null,
    host: diagnosticProxyHeader(request.headers.get("host")),
    forwardedHost: diagnosticProxyHeader(request.headers.get("x-forwarded-host")),
    forwardedProto: diagnosticProxyHeader(request.headers.get("x-forwarded-proto")),
    // These are the effective in-process settings, not a newly updated Secret.
    trustProxyHeaders: server.trust_proxy_headers,
    allowedOrigins: server.public_urls,
  };
}

/**
 * The single browser-origin boundary for Control.
 *
 * The decision is one question: did this request come from a page on an
 * allowlisted public origin? The browser sets `Origin` and a cross-site page
 * cannot forge it, so `Origin in server.public_urls` is the CSRF guarantee.
 *
 * Whether the proxy restated the public scheme/host is a deployment signal, not
 * an authorization fact: a disagreement is logged as
 * `control_origin_proxy_mismatch` and the write continues. Blocking there turned
 * a proxy header mistake into a total outage of browser writes.
 */
export default defineMiddleware((event) => {
  const request = event.req;
  const pathname = new URL(request.url).pathname;
  const rule = originRule(request.method, pathname);
  const requestId = controlRequestId(request);
  const origin = request.headers.get("origin");

  // Agent documents have an opaque origin and must never exercise Control cookies.
  if (origin === "null") {
    if (rule.opaqueOrigin === "allow") return;
    logger.log("warning", "control_origin_rejected", {
      ...proxyDiagnostics(request, null),
      reason: "isolated_origin",
    });
    return problemResponse(403, "Control access from an isolated Agent is forbidden.", {
      code: "CONTROL_ISOLATED_ORIGIN_FORBIDDEN",
      instance: requestId,
    });
  }
  if (!rule.cookieCsrf) return;

  const isLocalSignIn = pathname.replace(/\/+$/, "") === "/api/auth/sign-in/username";
  if (!request.headers.has("cookie") && !isLocalSignIn) return;
  // Without an Origin header a browser did not mediate this request, so cookie
  // CSRF does not apply and the session is validated downstream.
  if (!origin) return;

  const browserOrigin = diagnosticOrigin(origin);
  const server = getControlConfig().server;
  if (browserOrigin && server.public_urls.includes(browserOrigin)) {
    const resolution = resolveBrowserOrigin(request);
    if (!resolution.ok || resolution.origin !== browserOrigin) {
      logger.log("warning", "control_origin_proxy_mismatch", {
        ...proxyDiagnostics(request, resolution),
        reason: resolution.ok ? "resolved_origin_differs" : resolution.reason,
      });
    }
    return;
  }

  logger.log("warning", "control_origin_rejected", {
    ...proxyDiagnostics(request, resolveBrowserOrigin(request)),
    reason: "origin_not_allowed",
  });
  return problemResponse(403, "Request origin is not allowed.", {
    code: "CONTROL_ORIGIN_FORBIDDEN",
    instance: requestId,
  });
});
