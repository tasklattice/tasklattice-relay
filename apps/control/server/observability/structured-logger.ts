import { sanitizeRuntimeMemoryText } from "../runtime-bridge/memory-runtime-sanitizer";

export type StructuredLogLevel = "debug" | "error" | "info" | "warn";

export interface StructuredLogger {
  log(
    level: StructuredLogLevel,
    event: string,
    fields?: Record<string, unknown>,
  ): void;
}

const sensitiveKey =
  /(?:authorization|cookie|password|passphrase|secret|token|credential|api[-_]?key|master[-_]?key|private[-_]?key|client[-_]?secret|database[-_]?url)/i;

function sanitizeLogValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizeRuntimeMemoryText(value, 4_096);
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
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

function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorMessage: sanitizeRuntimeMemoryText(error.message, 4_096),
      errorName: error.name,
      ...(error.stack
        ? { errorStack: sanitizeRuntimeMemoryText(error.stack, 8_000) }
        : {}),
    };
  }
  return { errorMessage: sanitizeRuntimeMemoryText(String(error), 4_096) };
}

export function serializeError(error: unknown): Record<string, unknown> {
  return errorFields(error);
}

export function createStructuredLogger(
  component: string,
  baseFields: Record<string, unknown> = {},
): StructuredLogger {
  return {
    log(level, event, fields = {}) {
      const payload = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        component,
        event,
        ...(sanitizeLogValue(baseFields) as Record<string, unknown>),
        ...(sanitizeLogValue(fields) as Record<string, unknown>),
      });
      if (level === "error") console.error(payload);
      else if (level === "warn") console.warn(payload);
      else if (level === "debug") console.debug(payload);
      else console.info(payload);
    },
  };
}
