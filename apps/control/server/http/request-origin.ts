import { getControlConfig } from "../config/control-config";
import { ProblemError } from "./problem-error";

/**
 * Why a request could not be tied to one configured browser origin.
 *
 * - `host_missing`: no usable Host/forwarded host; the caller is not a browser
 *   talking to a configured public endpoint.
 * - `host_not_allowed`: the request names a host we do not serve. This is the
 *   caller's business (host scanning, wrong bookmark), not an outage.
 * - `origin_unverifiable`: the host is ours but the resolved scheme or port is
 *   not in `server.public_urls`. Only a proxy/configuration disagreement can
 *   produce this, so it is an operator problem, never a permission problem.
 */
export type OriginFailureReason =
  | "host_missing"
  | "host_not_allowed"
  | "origin_unverifiable";

export type OriginSuccess = {
  host: string;
  ok: true;
  origin: string;
  scheme: "http" | "https";
};

export type OriginFailure = {
  host: string | null;
  ok: false;
  reason: OriginFailureReason;
  resolvedOrigin: string | null;
};

export type OriginResolution = OriginSuccess | OriginFailure;

function parseHost(value: string | null): string | null {
  const raw = value?.trim().toLowerCase() ?? "";
  if (!raw || raw.length > 255) return null;
  // Reject credentials, paths, whitespace and quoting: only a bare host[:port]
  // may influence the resolved origin.
  if (/[\s/\\@"'<>?#]/.test(raw)) return null;
  try {
    return new URL(`http://${raw}`).host || null;
  } catch {
    return null;
  }
}

function parseScheme(value: string | null): "http" | "https" | null {
  const raw = value?.trim().toLowerCase();
  return raw === "http" || raw === "https" ? raw : null;
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Resolve the browser origin of a request against `server.public_urls`.
 *
 * Forwarded host and protocol are consumed only under
 * `server.trust_proxy_headers`, and only as a single `http`/`https` value with
 * a bare host. `Forwarded`, `X-Forwarded-Port` and comma-separated chains are
 * deliberately ignored; the trusted proxy must overwrite the headers with the
 * public endpoint. This is the only place that decides a request origin.
 */
export function resolveBrowserOrigin(request: Request): OriginResolution {
  const server = getControlConfig().server;
  const trusted = server.trust_proxy_headers;

  let url: URL | null = null;
  try {
    url = new URL(request.url);
  } catch {
    url = null;
  }

  const forwardedHost = trusted ? parseHost(request.headers.get("x-forwarded-host")) : null;
  const host = forwardedHost
    ?? parseHost(request.headers.get("host"))
    ?? (url?.host ? url.host.toLowerCase() : null);
  const forwardedScheme = trusted ? parseScheme(request.headers.get("x-forwarded-proto")) : null;
  const urlScheme = url?.protocol === "https:"
    ? "https"
    : url?.protocol === "http:"
      ? "http"
      : null;
  const scheme = forwardedScheme ?? urlScheme ?? "https";

  if (!host) {
    return { host: null, ok: false, reason: "host_missing", resolvedOrigin: null };
  }

  const resolvedOrigin = originOf(`${scheme}://${host}`);
  if (resolvedOrigin && server.public_urls.includes(resolvedOrigin)) {
    return { host, ok: true, origin: resolvedOrigin, scheme };
  }

  const hostname = hostnameOf(host);
  const hostServed = hostname !== null
    && server.public_urls.some((allowed) => hostnameOf(hostOf(allowed)) === hostname);
  return {
    host,
    ok: false,
    reason: hostServed ? "origin_unverifiable" : "host_not_allowed",
    resolvedOrigin,
  };
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function resolutionMessage(resolution: OriginFailure): string {
  const server = getControlConfig().server;
  return `Request origin is not in server.public_urls. Resolved origin: ${JSON.stringify(resolution.resolvedOrigin)}; `
    + `allowed origins: ${JSON.stringify(server.public_urls)}; `
    + `trust_proxy_headers: ${server.trust_proxy_headers}. `
    + "Check the public URL scheme and port, and the trusted ingress X-Forwarded-Host/Proto headers.";
}

/** Thrown by callers that must build absolute URLs; mirrors the resolution. */
export class OriginResolutionError extends ProblemError {
  constructor(readonly resolution: OriginFailure) {
    super(
      resolution.reason === "host_not_allowed" ? 403 : 503,
      resolution.reason === "host_not_allowed"
        ? "CONTROL_ORIGIN_FORBIDDEN"
        : "CONTROL_ORIGIN_CONFIGURATION_ERROR",
      resolutionMessage(resolution),
    );
    this.name = "OriginResolutionError";
  }
}

function refererOrigin(request: Request): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  return originOf(referer);
}

/**
 * Resolve the caller's origin; configured URLs are an allowlist, never a
 * redirect target.
 *
 * Header resolution is strict, so a proxy that hides the public endpoint is not
 * silently guessed. When it cannot resolve, an allowlisted `Origin`/`Referer`
 * is used, and finally the single configured public URL: with one entry there is
 * nothing to choose between. A value outside `public_urls` is never returned.
 */
export function requestOrigin(request: Request): string {
  const resolution = resolveBrowserOrigin(request);
  if (resolution.ok) return resolution.origin;
  const server = getControlConfig().server;
  for (const candidate of [request.headers.get("origin"), refererOrigin(request)]) {
    const origin = candidate ? originOf(candidate) : null;
    if (origin && server.public_urls.includes(origin)) return origin;
  }
  if (server.public_urls.length === 1) return server.public_urls[0]!;
  throw new OriginResolutionError(resolution);
}

export interface OriginContract {
  allowedOrigins: string[];
  hint?: string;
  /**
   * `suspicious` means the deployment cannot restate the public endpoint, so
   * proxy disagreement diagnostics are expected on every browser write. The
   * write path keeps working; the signal is for operators.
   */
  state: "ok" | "suspicious";
  trustProxyHeaders: boolean;
}

/** Static, request-independent verdict used by startup logs and `/api/health`. */
export function originContract(): OriginContract {
  const server = getControlConfig().server;
  const allowedOrigins = [...server.public_urls];
  const httpsOnly = allowedOrigins.every((origin) => origin.startsWith("https://"));
  if (!server.trust_proxy_headers && httpsOnly) {
    return {
      allowedOrigins,
      hint: "Every configured public URL uses HTTPS, but forwarded headers are ignored. "
        + "Control then resolves plaintext HTTP from its Service and logs "
        + "control_origin_proxy_mismatch on browser writes; allowlisted origins are still "
        + "accepted. Enable server.trust_proxy_headers behind an ingress that overwrites "
        + "X-Forwarded-Host and X-Forwarded-Proto, then confirm GET /api/health reports "
        + "origin.state=ok.",
      state: "suspicious",
      trustProxyHeaders: false,
    };
  }
  return { allowedOrigins, state: "ok", trustProxyHeaders: server.trust_proxy_headers };
}

export function sameOriginCallback(value: string, origin: string): string {
  const fallback = new URL("/", origin).href;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const target = new URL(value, origin);
    return target.origin === origin ? target.href : fallback;
  } catch {
    return fallback;
  }
}
