import { describe, expect, it } from "vitest";
import {
  calculateShare,
  calculateTrendChange,
  fillDailyActivity,
  groupByValue,
  parseCostFilters,
  serializeCostFilters,
  usd,
} from "./cost-utils";

describe("model cost aggregation helpers", () => {
  it("fills missing calendar dates without inventing activity", () => {
    expect(
      fillDailyActivity(
        [{ date: "2026-06-02", spend: 4, tokens: 12, requests: 2, active: 1 }],
        "2026-06-01",
        "2026-06-03",
      ),
    ).toEqual([
      { date: "2026-06-01", spend: 0, tokens: 0, requests: 0, active: 0 },
      { date: "2026-06-02", spend: 4, tokens: 12, requests: 2, active: 1 },
      { date: "2026-06-03", spend: 0, tokens: 0, requests: 0, active: 0 },
    ]);
  });

  it("calculates ranking share against the same total and handles zero totals", () => {
    expect(calculateShare(25, 100)).toBe(0.25);
    expect(calculateShare(25, 0)).toBe(0);
  });

  it("returns a meaningful trend only when the prior period has data", () => {
    expect(calculateTrendChange(118.6, 100)).toBeCloseTo(18.6);
    expect(calculateTrendChange(10, 0)).toBeUndefined();
  });

  it("selects values using the active group-by dimension", () => {
    const values = {
      work: "work-1",
      task: "work-1/R-1",
      instance: "research",
      model_endpoint: "gpt-5",
      provider_account: "openai-prod",
      virtual_key: "research-key",
    };
    expect(groupByValue(values, "model_endpoint")).toBe("gpt-5");
    expect(groupByValue(values, "virtual_key")).toBe("research-key");
  });

  it("keeps zero and sub-dollar USD amounts precise", () => {
    expect(usd(0)).toBe("$0.0000");
    expect(usd(0.125)).toBe("$0.1250");
    expect(usd(12_845.67)).toBe("$12,845.67");
  });

  it("round-trips combined filters in a URL-safe compact format", () => {
    const filters = {
      instance: ["instance-1"],
      model_endpoint: ["model/name"],
    };
    expect(parseCostFilters(serializeCostFilters(filters))).toEqual(filters);
  });
});
