import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";

const MEMORY_STATUSES = [
  "provisioning",
  "ready",
  "degraded",
  "unbound",
  "deleting",
  "deletion_failed",
  "deleted",
] as const;
const OUTBOX_STATUSES = [
  "pending",
  "processing",
  "retry",
  "delivered",
  "dead_letter",
] as const;
const RECALL_OUTCOMES = ["success", "timeout", "failure"] as const;
const RETAIN_OUTCOMES = ["success", "failure"] as const;
const LIFECYCLE_OPERATIONS = ["provisioning", "deletion"] as const;
const PROVIDER_HEALTH = ["healthy", "degraded", "unavailable"] as const;
const DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30] as const;

type RecallOutcome = (typeof RECALL_OUTCOMES)[number];
type RetainOutcome = (typeof RETAIN_OUTCOMES)[number];
type LifecycleOperation = (typeof LIFECYCLE_OPERATIONS)[number];
export type MemoryProviderHealth = (typeof PROVIDER_HEALTH)[number];

interface HistogramValue {
  buckets: number[];
  count: number;
  sum: number;
}

function counter<T extends readonly string[]>(keys: T): Record<T[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T[number], number>;
}

function histogram<T extends readonly string[]>(
  keys: T,
): Record<T[number], HistogramValue> {
  return Object.fromEntries(keys.map((key) => [key, {
    buckets: DURATION_BUCKETS.map(() => 0),
    count: 0,
    sum: 0,
  }])) as Record<T[number], HistogramValue>;
}

function metricHeader(lines: string[], name: string, help: string, type: string): void {
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
}

function histogramLines<T extends string>(
  lines: string[],
  name: string,
  help: string,
  label: string,
  values: Record<T, HistogramValue>,
  keys: readonly T[],
): void {
  metricHeader(lines, name, help, "histogram");
  for (const key of keys) {
    const value = values[key];
    DURATION_BUCKETS.forEach((boundary, index) => {
      lines.push(`${name}_bucket{${label}="${key}",le="${boundary}"} ${value.buckets[index]}`);
    });
    lines.push(
      `${name}_bucket{${label}="${key}",le="+Inf"} ${value.count}`,
      `${name}_sum{${label}="${key}"} ${value.sum}`,
      `${name}_count{${label}="${key}"} ${value.count}`,
    );
  }
}

function observe(value: HistogramValue, durationSeconds: number): void {
  const duration = Math.max(0, durationSeconds);
  value.count += 1;
  value.sum += duration;
  DURATION_BUCKETS.forEach((boundary, index) => {
    if (duration <= boundary) {
      value.buckets[index] = (value.buckets[index] ?? 0) + 1;
    }
  });
}

export class MemoryMetrics {
  private readonly recallTotal = counter(RECALL_OUTCOMES);
  private readonly recallDuration = histogram(RECALL_OUTCOMES);
  private readonly retainTotal = counter(RETAIN_OUTCOMES);
  private readonly retainDuration = histogram(RETAIN_OUTCOMES);
  private readonly lifecycleFailures = counter(LIFECYCLE_OPERATIONS);
  private outboxRetries = 0;
  private outboxDeadLetters = 0;
  private providerHealth: MemoryProviderHealth = "unavailable";

  observeRecall(outcome: RecallOutcome, durationSeconds: number): void {
    this.recallTotal[outcome] += 1;
    observe(this.recallDuration[outcome], durationSeconds);
  }

  observeRetain(
    outcome: RetainOutcome,
    durationSeconds: number,
    delivery: "delivered" | "retry" | "dead_letter",
  ): void {
    this.retainTotal[outcome] += 1;
    observe(this.retainDuration[outcome], durationSeconds);
    if (delivery === "retry") this.outboxRetries += 1;
    if (delivery === "dead_letter") this.outboxDeadLetters += 1;
  }

  recordLifecycleFailure(operation: LifecycleOperation): void {
    this.lifecycleFailures[operation] += 1;
  }

  recordProviderHealth(status: MemoryProviderHealth): void {
    this.providerHealth = status;
  }

  processLines(): string[] {
    const lines: string[] = [];
    metricHeader(lines, "tali_memory_recall_total", "Relay Memory recall attempts by outcome.", "counter");
    for (const outcome of RECALL_OUTCOMES) {
      lines.push(`tali_memory_recall_total{outcome="${outcome}"} ${this.recallTotal[outcome]}`);
    }
    histogramLines(
      lines,
      "tali_memory_recall_duration_seconds",
      "Relay Memory recall latency in seconds.",
      "outcome",
      this.recallDuration,
      RECALL_OUTCOMES,
    );
    metricHeader(lines, "tali_memory_retain_total", "Relay Memory retain deliveries by outcome.", "counter");
    for (const outcome of RETAIN_OUTCOMES) {
      lines.push(`tali_memory_retain_total{outcome="${outcome}"} ${this.retainTotal[outcome]}`);
    }
    histogramLines(
      lines,
      "tali_memory_retain_duration_seconds",
      "Relay Memory retain delivery latency in seconds.",
      "outcome",
      this.retainDuration,
      RETAIN_OUTCOMES,
    );
    metricHeader(lines, "tali_memory_lifecycle_failures_total", "Memory provisioning and deletion failures.", "counter");
    for (const operation of LIFECYCLE_OPERATIONS) {
      lines.push(`tali_memory_lifecycle_failures_total{operation="${operation}"} ${this.lifecycleFailures[operation]}`);
    }
    metricHeader(lines, "tali_memory_outbox_retries_total", "Memory retain events scheduled for retry.", "counter");
    lines.push(`tali_memory_outbox_retries_total ${this.outboxRetries}`);
    metricHeader(lines, "tali_memory_outbox_dead_letters_total", "Memory retain events sent to dead letter.", "counter");
    lines.push(`tali_memory_outbox_dead_letters_total ${this.outboxDeadLetters}`);
    metricHeader(lines, "tali_memory_provider_health", "Last observed Memory provider health, one-hot encoded.", "gauge");
    for (const status of PROVIDER_HEALTH) {
      lines.push(`tali_memory_provider_health{status="${status}"} ${this.providerHealth === status ? 1 : 0}`);
    }
    return lines;
  }
}

export const memoryMetrics = new MemoryMetrics();

export function metricsBearerAuthorized(
  authorization: string | undefined,
  expectedToken = process.env.TALI_METRICS_TOKEN,
): boolean {
  if (!expectedToken) return false;
  const supplied = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!supplied) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expectedToken);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function metricsRequestAuthorized(
  request: Request,
  expectedToken = process.env.TALI_METRICS_TOKEN,
): boolean {
  return metricsBearerAuthorized(
    request.headers.get("authorization") ?? undefined,
    expectedToken,
  );
}

export async function renderMemoryMetrics(
  database: PrismaClient,
  registry: MemoryMetrics = memoryMetrics,
  now = new Date(),
): Promise<string> {
  const [memoryGroups, activeBindings, unboundMemories, outboxGroups, oldest] =
    await Promise.all([
      database.memoryRecord.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      database.memoryBinding.count({ where: { status: "active" } }),
      database.memoryRecord.count({ where: { status: "unbound", deletedAt: null } }),
      database.memoryOutboxRecord.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      database.memoryOutboxRecord.findFirst({
        where: { status: { in: ["pending", "processing", "retry"] } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);
  const memoryCounts = new Map(memoryGroups.map((row) => [row.status, row._count._all]));
  const outboxCounts = new Map(outboxGroups.map((row) => [row.status, row._count._all]));
  const backlog = ["pending", "processing", "retry"]
    .reduce((sum, status) => sum + (outboxCounts.get(status as (typeof OUTBOX_STATUSES)[number]) ?? 0), 0);
  const oldestAgeSeconds = oldest
    ? Math.max(0, (now.getTime() - oldest.createdAt.getTime()) / 1_000)
    : 0;
  const lines = registry.processLines();
  metricHeader(lines, "tali_memory_resources", "Active Memory resources by lifecycle status.", "gauge");
  for (const status of MEMORY_STATUSES) {
    lines.push(`tali_memory_resources{status="${status}"} ${memoryCounts.get(status) ?? 0}`);
  }
  metricHeader(lines, "tali_memory_bindings", "Active bindings and unbound reusable Memories.", "gauge");
  lines.push(
    `tali_memory_bindings{state="active"} ${activeBindings}`,
    `tali_memory_bindings{state="unbound"} ${unboundMemories}`,
  );
  metricHeader(lines, "tali_memory_outbox_events", "Memory retain outbox rows by status.", "gauge");
  for (const status of OUTBOX_STATUSES) {
    lines.push(`tali_memory_outbox_events{status="${status}"} ${outboxCounts.get(status) ?? 0}`);
  }
  metricHeader(lines, "tali_memory_outbox_backlog", "Pending, processing, and retry Memory outbox rows.", "gauge");
  lines.push(`tali_memory_outbox_backlog ${backlog}`);
  metricHeader(lines, "tali_memory_outbox_oldest_event_age_seconds", "Age of the oldest undelivered Memory outbox event.", "gauge");
  lines.push(`tali_memory_outbox_oldest_event_age_seconds ${oldestAgeSeconds}`);
  return `${lines.join("\n")}\n`;
}
