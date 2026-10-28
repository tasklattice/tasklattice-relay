import { createConsola, type ConsolaReporter } from "consola/core";
import { sanitizeLogFields } from "./log-redaction";

export { serializeError } from "./log-redaction";

export type StructuredLogLevel = "critical" | "error" | "warning" | "info";

export interface StructuredLogger {
  log(level: StructuredLogLevel, event: string, fields?: Record<string, unknown>): void;
}

const methods = {
  critical: "fatal",
  error: "error",
  warning: "warn",
  info: "info",
} as const;
const severity = { fatal: "critical", error: "error", warn: "warning", info: "info" } as const;

// Only the Relay JSON schema lives here. Consola owns log dispatch, timestamps,
// component tags and severity filtering. Do not wrap the global console.
const jsonReporter: ConsolaReporter = {
  log(record) {
    const level = severity[record.type as keyof typeof severity];
    if (!level) return;
    const [event, fields] = record.args as [string, Record<string, unknown>];
    const payload = JSON.stringify({
      ...fields,
      timestamp: record.date.toISOString(),
      level,
      component: record.tag,
      event,
    });
    if (level === "critical" || level === "error") console.error(payload);
    else if (level === "warning") console.warn(payload);
    else console.info(payload);
  },
};

const consola = createConsola({
  level: 3,
  // Each request/job event must survive independently, even when identical.
  throttle: 0,
  reporters: [jsonReporter],
});

export function createStructuredLogger(
  component: string,
  baseFields: Record<string, unknown> = {},
): StructuredLogger {
  const logger = consola.withTag(component);
  return {
    log(level, event, fields = {}) {
      // Redact before passing data to the library, including its last-log state.
      logger[methods[level]](event, {
        ...sanitizeLogFields(baseFields),
        ...sanitizeLogFields(fields),
      });
    },
  };
}
