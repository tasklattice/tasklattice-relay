import { useMemo } from "react";
import { ResponsiveLine, type LineSeries, type SliceTooltipProps } from "@nivo/line";
import type {
  ProjectOverviewRange,
  ProjectOverviewUsagePoint,
} from "@tali/contracts";
import { nivoChartTheme } from "@/components/shared/nivo-theme";

export type UsageMetric = "runs" | "tokens" | "cost";

interface UsageLineSeries extends LineSeries {
  id: UsageMetric;
  data: Array<{ x: string; y: number }>;
}

const metricLabels: Record<UsageMetric, string> = {
  tokens: "Tokens",
  runs: "Runs",
  cost: "Cost",
};

const emptyDescriptions: Record<UsageMetric, string> = {
  tokens: "Token usage will appear after the first attributed model request.",
  runs: "A Run is one complete Agent execution reported by the Runtime.",
  cost: "Spend will appear after model usage is priced and synchronized.",
};

function valueFor(point: ProjectOverviewUsagePoint, metric: UsageMetric): number {
  if (metric === "runs") return point.runs;
  if (metric === "tokens") return point.tokens;
  return point.costUsd;
}

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 2 : 0,
  }).format(value);
}

function formatValue(value: number, metric: UsageMetric): string {
  return metric === "cost" ? money(value) : compact(value);
}

function bucketLabel(bucket: string, range: ProjectOverviewRange): string {
  return range === "24h" ? bucket.slice(11, 16) : bucket.slice(5).replace("-", "/");
}

function selectTicks(points: ProjectOverviewUsagePoint[]): string[] {
  const buckets = points.map((point) => point.bucket);
  if (buckets.length <= 6) return buckets;
  return [...new Set([
    buckets[0],
    buckets[Math.floor((buckets.length - 1) / 4)],
    buckets[Math.floor((buckets.length - 1) / 2)],
    buckets[Math.floor(((buckets.length - 1) * 3) / 4)],
    buckets.at(-1),
  ].filter((value): value is string => Boolean(value)))];
}

function UsageTooltip({
  metric,
  point,
  range,
}: {
  metric: UsageMetric;
  point: ProjectOverviewUsagePoint | undefined;
  range: ProjectOverviewRange;
}) {
  if (!point) return null;
  return (
    <div className="min-w-40 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md">
      <p className="text-muted-foreground">
        {range === "24h" ? point.bucket.replace("T", " · ") : point.bucket}
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-6">
        <span>{metricLabels[metric]}</span>
        <strong className="tabular-nums">{formatValue(valueFor(point, metric), metric)}</strong>
      </div>
    </div>
  );
}

export function UsageChart({
  metric,
  points,
  range,
}: {
  metric: UsageMetric;
  points: ProjectOverviewUsagePoint[];
  range: ProjectOverviewRange;
}) {
  const pointByBucket = useMemo(
    () => new Map(points.map((point) => [point.bucket, point])),
    [points],
  );
  const data = useMemo<UsageLineSeries[]>(() => [{
    id: metric,
    data: points.map((point) => ({
      x: point.bucket,
      y: valueFor(point, metric),
    })),
  }], [metric, points]);
  const tickValues = selectTicks(points);
  const hasData = points.some((point) => valueFor(point, metric) > 0);
  const maximum = Math.max(0, ...points.map((point) => valueFor(point, metric)));

  return (
    <div className="relative h-[300px] w-full sm:h-[330px]">
      <ResponsiveLine<UsageLineSeries>
        data={data}
        margin={{ top: 18, right: 16, bottom: 38, left: 58 }}
        xScale={{ type: "point" }}
        yScale={{
          type: "linear",
          min: 0,
          max: maximum > 0 ? maximum * 1.1 : 1,
          stacked: false,
        }}
        axisBottom={{
          format: (value) => bucketLabel(String(value), range),
          tickPadding: 8,
          tickSize: 0,
          tickValues,
        }}
        axisLeft={{
          format: (value) => formatValue(Number(value), metric),
          tickPadding: 8,
          tickSize: 0,
          tickValues: 5,
        }}
        axisRight={null}
        axisTop={null}
        colors={["var(--overview-series-1)"]}
        curve="linear"
        lineWidth={2}
        enableArea
        areaOpacity={0.08}
        enablePoints={points.length <= 30}
        pointSize={4}
        pointColor={{ from: "seriesColor" }}
        pointBorderColor={{ from: "serieColor" }}
        pointBorderWidth={1}
        enableGridX={false}
        enableGridY
        enableSlices="x"
        enableCrosshair
        crosshairType="x"
        sliceTooltip={({ slice }: SliceTooltipProps<UsageLineSeries>) => (
          <UsageTooltip
            metric={metric}
            point={pointByBucket.get(String(slice.points[0]?.data.x))}
            range={range}
          />
        )}
        useMesh
        animate={false}
        isFocusable
        pointAriaLabel={(point) =>
          `${metricLabels[metric]}, ${String(point.data.x)}: ${formatValue(Number(point.data.y), metric)}`
        }
        role="img"
        ariaLabel={`${metricLabels[metric]} usage for the selected period`}
        theme={nivoChartTheme}
      />
      {!hasData ? (
        <div className="absolute inset-0 grid place-items-center bg-card/80 text-center">
          <div>
            <p className="text-sm font-medium">No {metricLabels[metric].toLowerCase()} recorded</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {emptyDescriptions[metric]}
            </p>
          </div>
        </div>
      ) : null}
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.bucket}>
            {point.bucket}: {formatValue(valueFor(point, metric), metric)} {metricLabels[metric]}
          </li>
        ))}
      </ul>
    </div>
  );
}
