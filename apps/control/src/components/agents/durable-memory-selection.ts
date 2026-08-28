import type { AgentPlatformId, MemoryResourceView } from "@tali/contracts";

export function supportsDurableMemoryPlatform(agentPlatform: AgentPlatformId): boolean {
  return agentPlatform === "openclaw" || agentPlatform === "hermes";
}

export function bindableDurableMemories(
  memories: readonly MemoryResourceView[],
): MemoryResourceView[] {
  return memories.filter((memory) =>
    !memory.activeBinding
    && (memory.status === "ready" || memory.status === "unbound")
  );
}
