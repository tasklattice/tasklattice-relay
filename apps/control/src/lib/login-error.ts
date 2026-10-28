export type LoginErrorKind =
  | "credentials" | "origin" | "configuration" | "forbidden"
  | "rateLimit" | "network" | "service" | "unknown";

/** Use protocol codes, never arbitrary server text, for user-facing messages. */
export function classifyLoginError(error: unknown): LoginErrorKind {
  if (error instanceof TypeError) return "network";
  if (!error || typeof error !== "object") return "unknown";
  const { code, status } = error as { code?: string; status?: number };
  if (code === "CONTROL_ORIGIN_CONFIGURATION_ERROR") return "configuration";
  if (code === "CONTROL_ORIGIN_FORBIDDEN" || code === "INVALID_ORIGIN") return "origin";
  if (code === "INVALID_USERNAME_OR_PASSWORD" || code === "INVALID_EMAIL_OR_PASSWORD") return "credentials";
  if (status === 429) return "rateLimit";
  if (status === 403) return "forbidden";
  if (typeof status === "number" && status >= 500) return "service";
  return "unknown";
}
