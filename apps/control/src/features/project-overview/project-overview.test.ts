import type { ProjectOverviewResponse } from "@tali/contracts";
import { describe, expect, it } from "vitest";
import { getRuntimeSummary } from "./project-overview";

type RuntimeSummaryInput = ProjectOverviewResponse["runtime"];

function runtime(
  values: Partial<RuntimeSummaryInput> = {},
): RuntimeSummaryInput {
  return {
    available: true,
    ready: 0,
    provisioning: 0,
    failed: 0,
    destroying: 0,
    total: 0,
    ...values,
  };
}

describe("Project overview Runtime status", () => {
  it("prioritizes failures over transitional states", () => {
    expect(
      getRuntimeSummary(runtime({ failed: 1, provisioning: 2, total: 3 })),
    ).toMatchObject({ label: "Needs attention", tone: "danger" });
  });

  it("treats provisioning and destroying as a lifecycle transition", () => {
    expect(
      getRuntimeSummary(runtime({ provisioning: 1, destroying: 1, total: 2 })),
    ).toEqual({
      description: "2 Instances are changing lifecycle state.",
      label: "Changing",
      tone: "warning",
    });
  });

  it("only reports Healthy when every Instance is ready", () => {
    expect(
      getRuntimeSummary(runtime({ ready: 4, total: 4 })),
    ).toMatchObject({ label: "Healthy", tone: "success" });
    expect(
      getRuntimeSummary(runtime({ ready: 3, total: 4 })),
    ).not.toMatchObject({ label: "Healthy" });
  });

  it("uses a neutral empty state when no Runtime exists", () => {
    expect(getRuntimeSummary(runtime())).toMatchObject({
      label: "No runtime",
      tone: "neutral",
    });
  });
});
