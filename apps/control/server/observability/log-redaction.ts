import { sanitizeRuntimeMemoryText } from "../runtime-bridge/memory-runtime-sanitizer";

const sensitiveKey =
  /(?:authorization|cookie|password|passphrase|secret|token|credential|api[-_]?key|master[-_]?key|private[-_]?key|client[-_]?secret|database[-_]?url)/i;

function sanitizeLogText(value: string, maxLength: number): string {
  // Preserve generated UUID correlation IDs; the memory sanitizer also masks
  // phone-like digit sequences, which must not alter request/error IDs.
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) return value;
  const safe = value
    .replace(/\b(?:set-cookie|cookie|authorization)\s*:\s*[^\r\n]+/gi, "[REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (text) => {
      try {
        const url = new URL(text);
        if (!url.username && !url.password && !url.search && !url.hash) return text;
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch { return "[REDACTED_URL]"; }
    })
    .replace(/(["']?(?:password|secret|token|api[_-]?key|client[_-]?secret)["']?\s*[:=]\s*)(["'])(.*?)\2/gi,
      "$1[REDACTED]");
  return sanitizeRuntimeMemoryText(safe, maxLength);
}

function sanitizeLogValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizeLogText(value, 4_096);
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (value instanceof Error) return errorFields(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeLogValue(item, depth + 1, seen));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [
      key,
      sensitiveKey.test(key)
        ? "[REDACTED]"
        : sanitizeLogValue(item, depth + 1, seen),
    ]),
  );
}

function errorFields(error: unknown, depth = 0): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorMessage: sanitizeLogText(error.message, 4_096),
      errorName: sanitizeLogText(error.name, 256),
      ...("code" in error && ["string", "number"].includes(typeof error.code)
        ? { errorCode: sanitizeLogText(String(error.code), 256) } : {}),
      ...(error.cause !== undefined && depth < 3
        ? { cause: errorFields(error.cause, depth + 1) } : {}),
      ...(error.stack
        ? { errorStack: sanitizeLogText(error.stack, 8_000) }
        : {}),
    };
  }
  return { errorMessage: sanitizeLogText(String(error), 4_096) };
}

export function serializeError(error: unknown): Record<string, unknown> {
  return errorFields(error);
}

export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return sanitizeLogValue(fields) as Record<string, unknown>;
}
