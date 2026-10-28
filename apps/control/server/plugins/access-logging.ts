import { definePlugin } from "nitro";
import { accessLogRecord } from "../http/access-log";
import { getControlConfig } from "../config/control-config";
import { originContract } from "../http/request-origin";
import { controlRequestId } from "../observability/request-diagnostics";
import { createStructuredLogger, serializeError } from "../observability/structured-logger";

const logger = createStructuredLogger("control");

export default definePlugin((nitro) => {
  const accessLogEnabled = process.env.TALI_ACCESS_LOG_ENABLED === "true";
  const started = new WeakMap<Request, number>();
  nitro.hooks.hook("request", (event) => {
    controlRequestId(event.req);
    started.set(event.req, performance.now());
  });
  nitro.hooks.hook("response", (response, event) => {
    const requestId = controlRequestId(event.req);
    // Some upstream/upgrade responses have immutable headers. Logging must
    // never turn a successful proxy response into an application failure.
    try { response.headers.set("x-request-id", requestId); } catch { /* immutable response */ }
    const websocket = Boolean((response as Response & { crossws?: unknown }).crossws);
    if (!accessLogEnabled && response.status < 400) return;
    const record = accessLogRecord(event.req, websocket ? 101 : response.status,
      started.get(event.req) ?? performance.now(), websocket);
    const errorId = response.headers.get("x-control-error-id");
    logger.log(response.status >= 500 ? "error" : response.status >= 400 ? "warning" : "info",
      record.event, {
        ...record,
        requestId,
        ...(errorId && /^[0-9a-f-]{36}$/.test(errorId) ? { errorId } : {}),
      });
  });
  nitro.hooks.hook("error", (error, context) => {
    const fatal = context.tags?.some((tag) =>
      ["uncaughtException", "unhandledRejection", "plugin"].includes(tag)) ?? false;
    logger.log(fatal ? "critical" : "error", "runtime.error", {
      scope: fatal ? "process" : context.event ? "request" : "background",
      ...(context.event ? { requestId: controlRequestId(context.event.req) } : {}),
      ...serializeError(error),
    });
  });
  nitro.hooks.hook("close", () => logger.log("info", "control.stopped"));
  // H3 otherwise prints the raw Error before invoking the error hook, bypassing
  // redaction and duplicating the structured runtime.error record.
  if (nitro.h3) nitro.h3.config.silent = true;
  try {
    const { server } = getControlConfig();
    logger.log("info", "control.started", {
      pid: process.pid,
      accessLogEnabled,
      allowedOrigins: server.public_urls,
      trustProxyHeaders: server.trust_proxy_headers,
    });
    // An HTTPS-only allowlist without forwarded headers can never match the
    // plaintext request Control receives from its Service. Report it at boot
    // instead of leaving the first browser write to fail.
    const contract = originContract();
    if (contract.state === "suspicious") {
      logger.log("warning", "control.origin_contract_suspicious", {
        allowedOrigins: contract.allowedOrigins,
        trustProxyHeaders: contract.trustProxyHeaders,
        hint: contract.hint,
      });
    }
  } catch (error) {
    logger.log("critical", "control.configuration_failed", serializeError(error));
    throw error;
  }
});
