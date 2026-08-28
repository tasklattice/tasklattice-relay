import type { MemoryResourceView } from "@tali/contracts";
import { describe, expect, it } from "vitest";
import {
  bindableDurableMemories,
  supportsDurableMemoryPlatform,
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
  it("supports both OpenClaw and Hermes without enabling unrelated platforms", () => {
    expect(supportsDurableMemoryPlatform("openclaw")).toBe(true);
    expect(supportsDurableMemoryPlatform("hermes")).toBe(true);
    expect(supportsDurableMemoryPlatform("deepagents")).toBe(false);
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
