import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RuntimeStatusBadge,
  StatusBadge,
  StatusBanner,
  StatusSummaryCard,
  SystemStatusBadge,
  statusToneClass,
  systemStatusTone,
} from "./status";

describe("shared status primitives", () => {
  it("renders semantic success styles instead of feature-level color literals", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusBadge, { label: "Healthy", tone: "success" }),
    );

    expect(markup).toContain("Healthy");
    expect(markup).toContain("bg-success-surface");
    expect(markup).toContain("text-success-foreground");
    expect(statusToneClass("success", "dot")).toBe("bg-success");
  });

  it("maps a ready runtime to the success role rather than the brand role", () => {
    const markup = renderToStaticMarkup(
      createElement(RuntimeStatusBadge, { status: "READY" }),
    );

    expect(markup).toContain("Ready");
    expect(markup).toContain("bg-success-surface");
    expect(markup).toContain("text-success-foreground");
    expect(markup).not.toContain("bg-info-surface");
  });

  it.each([
    ["READY", "success"],
    ["HEALTHY", "success"],
    ["REGISTERED", "success"],
    ["PROVISIONING", "info"],
    ["ACTIVATING", "info"],
    ["DEGRADED", "warning"],
    ["VALIDATION_REQUIRED", "warning"],
    ["RETRY", "warning"],
    ["FAILED", "danger"],
    ["BLOCKED", "danger"],
    ["NON_COMPLIANT", "danger"],
    ["INACTIVE", "neutral"],
    ["PAUSED", "neutral"],
    ["CANCELLED", "neutral"],
    ["NEW_BACKEND_STATE", "neutral"],
  ] as const)("maps %s to the %s system tone", (status, tone) => {
    expect(systemStatusTone(status)).toBe(tone);
  });

  it("normalizes system status labels and animates transitional states", () => {
    const markup = renderToStaticMarkup(
      createElement(SystemStatusBadge, { status: "in-progress" }),
    );

    expect(markup).toContain("In progress");
    expect(markup).toContain("bg-info-surface");
    expect(markup).toContain("animate-ping");
  });

  it("uses an alert role only for dangerous banners", () => {
    const danger = renderToStaticMarkup(
      createElement(StatusBanner, {
        children: "Retry is available.",
        title: "Provisioning failed",
        tone: "danger",
      }),
    );
    const healthy = renderToStaticMarkup(
      createElement(StatusBanner, {
        children: "All checks passed.",
        title: "Ready",
        tone: "success",
      }),
    );

    expect(danger).toContain('role="alert"');
    expect(healthy).toContain('role="status"');
  });

  it("keeps a summary label, value, and explanation together", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusSummaryCard, {
        description: "Every Instance is ready.",
        eyebrow: "Runtime health",
        label: "Healthy",
        tone: "success",
        value: "4 / 4",
      }),
    );

    expect(markup).toContain("Runtime health");
    expect(markup).toContain("4 / 4");
    expect(markup).toContain("Every Instance is ready.");
  });
});
