import { describe, expect, it } from "vitest";
import {
  InvalidMemoryTransitionError,
  transitionMemoryBindingStatus,
  transitionMemoryStatus,
} from "./memory-domain";

describe("Durable Memory state machines", () => {
  it.each([
    ["provisioning", "ready"],
    ["provisioning", "degraded"],
    ["ready", "unbound"],
    ["ready", "degraded"],
    ["degraded", "ready"],
    ["unbound", "ready"],
    ["ready", "deleting"],
    ["deleting", "deletion_failed"],
    ["deletion_failed", "deleting"],
    ["deleting", "deleted"],
  ] as const)("allows Memory transition %s -> %s", (from, to) => {
    expect(transitionMemoryStatus(from, to)).toEqual({
      from,
      to,
      changed: true,
      event: { type: "memory.status_changed", from, to },
    });
  });

  it.each([
    ["provisioning", "unbound"],
    ["ready", "deleted"],
    ["unbound", "deleted"],
    ["deletion_failed", "ready"],
    ["deleted", "ready"],
  ] as const)("rejects Memory transition %s -> %s", (from, to) => {
    expect(() => transitionMemoryStatus(from, to)).toThrow(InvalidMemoryTransitionError);
  });

  it("treats a repeated Memory transition as an idempotent no-op", () => {
    expect(transitionMemoryStatus("ready", "ready")).toEqual({
      from: "ready",
      to: "ready",
      changed: false,
      event: null,
    });
  });

  it.each([
    ["pending", "active"],
    ["pending", "detached"],
    ["active", "detached"],
  ] as const)("allows binding transition %s -> %s", (from, to) => {
    expect(transitionMemoryBindingStatus(from, to)).toEqual({
      from,
      to,
      changed: true,
      event: { type: "memory_binding.status_changed", from, to },
    });
  });

  it.each([
    ["active", "pending"],
    ["detached", "active"],
  ] as const)("rejects binding transition %s -> %s", (from, to) => {
    expect(() => transitionMemoryBindingStatus(from, to)).toThrow(
      InvalidMemoryTransitionError,
    );
  });
});
