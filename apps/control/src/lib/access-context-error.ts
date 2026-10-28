export type AccessContextErrorKind =
  | "configuration" | "origin" | "contextUnavailable" | "forbidden"
  | "authentication" | "network" | "rateLimit" | "service" | "unknown";

export class AccessContextRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    message = `Request failed (${status}).`,
  ) {
    super(message);
    this.name = "AccessContextRequestError";
  }
}

/** Classify by protocol fields; a generic denial does not establish stale access. */
export function classifyAccessContextError(error: unknown): AccessContextErrorKind {
  if (error instanceof TypeError) return "network";
  if (!error || typeof error !== "object") return "unknown";
  const { code, status } = error as { code?: unknown; status?: unknown };
  if (code === "CONTROL_ORIGIN_CONFIGURATION_ERROR") return "configuration";
  if (code === "CONTROL_ORIGIN_FORBIDDEN" || code === "CONTROL_ISOLATED_ORIGIN_FORBIDDEN") return "origin";
  if (status === 403 && code === "access_context_not_assigned") return "contextUnavailable";
  if (status === 401) return "authentication";
  if (status === 403) return "forbidden";
  if (status === 429) return "rateLimit";
  if (typeof status === "number" && status >= 500) return "service";
  return "unknown";
}
