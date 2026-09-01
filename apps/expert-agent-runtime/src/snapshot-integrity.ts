import { createHash } from "node:crypto";
import {
  expertAgentVersionSnapshotSchema,
  type ExpertAgentVersionSnapshot,
} from "@tali/contracts";

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite Version number.");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  throw new TypeError(`Unsupported Version value: ${typeof value}.`);
}

export function runtimeVersionDigest(snapshot: ExpertAgentVersionSnapshot): string {
  const parsed = expertAgentVersionSnapshotSchema.parse(snapshot);
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalValue(parsed)))
    .digest("hex")}`;
}
