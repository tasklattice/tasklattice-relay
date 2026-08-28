import type {
  CostDailyPoint,
  CostFilterKey,
  CostFilters,
  CostGroupBy,
} from "@tali/contracts";

export type CostRange =
  | "7d"
  | "30d"
  | "90d"
  | "current_month"
  | "previous_month"
  | "custom";

export const costGroupLabels: Record<CostGroupBy, string> = {
  instance: "Instance",
  model_endpoint: "model endpoint",
  provider_account: "Provider",
  virtual_key: "virtual key",
};

export const costFilterLabels: Record<CostFilterKey, string> = {
  instance: "Instance",
  model_endpoint: "Model endpoint",
  provider: "Provider",
  provider_account: "Provider",
  virtual_key: "Virtual key",
  project: "Project",
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
}

export function resolveCostRange(
  range: CostRange,
  now = new Date(),
  custom?: { from?: string; to?: string },
): { from: string; to: string } {
  const today = startOfDay(now);
  if (range === "custom" && custom?.from && custom.to) {
    return custom.from <= custom.to
      ? { from: custom.from, to: custom.to }
      : { from: custom.to, to: custom.from };
  }
  if (range === "current_month") {
    return {
      from: isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
      to: isoDate(today),
    };
  }
  if (range === "previous_month") {
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    return { from: isoDate(start), to: isoDate(end) };
  }
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - days + 1);
  return { from: isoDate(from), to: isoDate(today) };
}

export function fillDailyActivity(
  points: CostDailyPoint[],
  from: string,
  to: string,
): CostDailyPoint[] {
  const lookup = new Map(points.map((point) => [point.date, point]));
  const result: CostDailyPoint[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    const date = isoDate(cursor);
    result.push(
      lookup.get(date) ?? { date, spend: 0, tokens: 0, requests: 0, active: 0 },
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function calculateShare(spend: number, totalSpend: number): number {
  return totalSpend > 0 ? Math.max(0, spend) / totalSpend : 0;
}

export function calculateTrendChange(
  current: number,
  previous: number,
): number | undefined {
  return previous > 0 ? ((current - previous) / previous) * 100 : undefined;
}

export function groupByValue<T extends Record<CostGroupBy, unknown>>(
  values: T,
  groupBy: CostGroupBy,
): T[CostGroupBy] {
  return values[groupBy];
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000_000 ? 2 : 1,
  }).format(value);
}

export function usd(value: number): string {
  const fourDecimals = Math.abs(value) < 1;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fourDecimals ? 4 : 2,
    maximumFractionDigits: fourDecimals ? 4 : 2,
  }).format(value);
}

export function parseCostFilters(value?: string): CostFilters {
  if (!value) return {};
  if (!value.startsWith("{")) {
    const validKeys = new Set(Object.keys(costFilterLabels));
    return Object.fromEntries(
      value.split(";").flatMap((part) => {
        const [key, encodedValues] = part.split("=", 2);
        if (!key || !encodedValues || !validKeys.has(key)) return [];
        const values = encodedValues.split(",").flatMap((item) => {
          try {
            return [decodeURIComponent(item)];
          } catch {
            return [];
          }
        });
        return values.length ? [[key, values]] : [];
      }),
    ) as CostFilters;
  }
  try {
    const parsed = JSON.parse(value) as CostFilters;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, values]) =>
          Array.isArray(values) && values.every((item) => typeof item === "string"),
      ),
    ) as CostFilters;
  } catch {
    return {};
  }
}

export function serializeCostFilters(filters: CostFilters): string | undefined {
  const compact = Object.entries(filters)
      .filter(([, values]) => values?.length)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => `${key}=${values!.map(encodeURIComponent).join(",")}`)
      .join(";");
  return compact || undefined;
}
