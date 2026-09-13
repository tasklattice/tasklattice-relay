import type { MemoryResourceView } from "@tali/contracts";
import { describe, expect, it } from "vitest";
import {
  bindableDurableMemories,
  supportsDurableMemoryPlatform,
  supportsNativeMemoryPlatform,
  instanceMemoryInput,
  nativeMemorySelection,
} from "./durable-memory-selection";

function memory(
  id: string,
  status: MemoryResourceView["status"],
  activeBinding: MemoryResourceView["activeBinding"] = null,
): MemoryResourceView {
  return {
    id,
    displayName: id,
    status,
    lastActivityAt: null,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    activeBinding,
    counts: { conversations: 0, facts: 0, experiences: 0, insights: 0 },
  };
}

describe("Durable Memory selection for Agent creation", () => {
  it.each(["hermes", "openclaw", "deepagents"] as const)(
    "creates %s with Native Memory independently of embedding readiness",
    (platform) => {
      for (const available of [false, true]) {
        expect(instanceMemoryInput(platform, available, nativeMemorySelection))
          .toEqual({ memory: { mode: "native", citations: "auto" } });
      }
      expect(instanceMemoryInput(platform, false, "old-memory-selection"))
        .toEqual({ memory: { mode: "native", citations: "auto" } });
    },
  );

  it("keeps explicitly selected Durable Memory separate from Native Memory", () => {
    expect(instanceMemoryInput("hermes", true, "memory-a"))
      .toEqual({ durableMemoryId: "memory-a" });
    expect(instanceMemoryInput("openclaw", true, "")).toEqual({});
    expect(instanceMemoryInput("deepagents", true, ""))
      .toEqual({ memory: { mode: "native", citations: "auto" } });
  });
  it("supports both OpenClaw and Hermes without enabling unrelated platforms", () => {
    expect(supportsDurableMemoryPlatform("openclaw")).toBe(true);
    expect(supportsDurableMemoryPlatform("hermes")).toBe(true);
    expect(supportsDurableMemoryPlatform("deepagents")).toBe(false);
  });

  it("uses Native text Memory as the fallback only for supported runtimes", () => {
    expect(supportsNativeMemoryPlatform("openclaw")).toBe(true);
    expect(supportsNativeMemoryPlatform("hermes")).toBe(true);
    expect(supportsNativeMemoryPlatform("deepagents")).toBe(true);
  });

  it("offers only ready or unbound Memories without an active binding", () => {
    const activeBinding = {
      id: "binding-1",
      instanceId: "agent-1",
      runtimeType: "openclaw" as const,
      status: "active" as const,
      attachedAt: "2026-08-28T00:00:00.000Z",
      detachedAt: null,
    };
    expect(bindableDurableMemories([
      memory("ready-free", "ready"),
      memory("unbound-free", "unbound"),
      memory("ready-bound", "ready", activeBinding),
      memory("provisioning", "provisioning"),
      memory("degraded", "degraded"),
      memory("deleting", "deleting"),
    ]).map(({ id }) => id)).toEqual(["ready-free", "unbound-free"]);
  });
});
