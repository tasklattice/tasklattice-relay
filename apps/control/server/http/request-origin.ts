import { resolveDynamicBaseURL } from "better-auth";
import { getControlConfig } from "../config/control-config";

/** Resolve the caller's origin; configured URLs are an allowlist, never a redirect target. */
export function requestOrigin(request: Request): string {
  const server = getControlConfig().server;
  const origin = new URL(
    resolveDynamicBaseURL(
      { allowedHosts: server.public_urls, protocol: "auto" },
      request,
      "",
      server.trust_proxy_headers,
    ),
  ).origin;
  // Better Auth checks hosts; also enforce the configured protocol and port.
  if (!server.public_urls.includes(origin)) {
    throw new Error(
      `Request origin is not in server.public_urls. Resolved origin: ${JSON.stringify(origin)}; `
      + `allowed origins: ${JSON.stringify(server.public_urls)}; `
      + `trust_proxy_headers: ${server.trust_proxy_headers}. `
      + "Check the public URL scheme and port, and the trusted ingress X-Forwarded-Host/Proto headers.",
    );
  }
  return origin;
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
