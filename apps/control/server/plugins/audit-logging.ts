import { definePlugin } from "nitro";
import { createStructuredLogger, serializeError } from "../observability/structured-logger";
import { controlRequestId } from "../observability/request-diagnostics";
import {
  captureAuditRequest,
  captureDeniedAdmissionRequest,
  purgeExpiredAuditLogs,
  writeAuditResponse,
  type CapturedAuditRequest,
} from "../audit-logs/audit-request";
import {
  admissionEvidenceForRequest,
  decisiveAdmissionEvidence,
} from "../authorization/authorization-context";

interface AuditRequestContext extends Record<string, unknown> {
  platformAuditCapture?: CapturedAuditRequest;
}

const cleanupIntervalMs = 24 * 60 * 60 * 1000;

const logger = createStructuredLogger("control");

export default definePlugin((nitro) => {
  nitro.hooks.hook("request", async (event) => {
    const context = (event.req.context ??= {}) as AuditRequestContext;
    const captured = await captureAuditRequest(event.req);
    if (captured) context.platformAuditCapture = captured;
  });
  nitro.hooks.hook("response", async (response, event) => {
    let captured = (event.req.context as AuditRequestContext | undefined)
      ?.platformAuditCapture;
    const admission = admissionEvidenceForRequest(event.req);
    if (!captured) {
      const decisive = decisiveAdmissionEvidence(admission);
      if (!decisive || decisive.decision === "ALLOW") return;
      captured = await captureDeniedAdmissionRequest(event.req, decisive);
    }
    captured.admission = admission;
    const write = writeAuditResponse(captured, response).catch((error) => {
      logger.log("error", "audit.write_failed", {
        requestId: controlRequestId(event.req), ...serializeError(error),
      });
    });
    if (event.req.waitUntil) {
      void event.req.waitUntil(write);
    } else {
      void write;
    }
  });

  void purgeExpiredAuditLogs()
    .then((deleted) => {
      if (deleted) logger.log("info", "audit.retention_completed", { deleted });
    })
    .catch((error) => {
      logger.log("error", "audit.retention_failed", { phase: "initial", ...serializeError(error) });
    });
  const timer = setInterval(() => {
    void purgeExpiredAuditLogs().catch((error) => {
      logger.log("error", "audit.retention_failed", { phase: "scheduled", ...serializeError(error) });
    });
  }, cleanupIntervalMs);
  timer.unref();
});
