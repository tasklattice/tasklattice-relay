import { getAgentPlatformDefinition, type AgentPlatformId, type MemoryResourceView } from "@tali/contracts";

export function supportsDurableMemoryPlatform(agentPlatform: AgentPlatformId): boolean {
  return agentPlatform === "openclaw" || agentPlatform === "hermes";
}

export const nativeMemorySelection = "native";

export function supportsNativeMemoryPlatform(agentPlatform: AgentPlatformId): boolean {
  return getAgentPlatformDefinition(agentPlatform).capabilities.memory !== "none";
}

export function instanceMemoryInput(
  agentPlatform: AgentPlatformId,
  durableMemoryAvailable: boolean,
  selection: string,
) {
  if (!durableMemoryAvailable || !supportsDurableMemoryPlatform(agentPlatform)
    || selection === nativeMemorySelection) {
    return { memory: { mode: "native", citations: "auto" } as const };
  }
  return selection ? { durableMemoryId: selection } : {};
}

export function bindableDurableMemories(
  memories: readonly MemoryResourceView[],
): MemoryResourceView[] {
  return memories.filter((memory) =>
    !memory.activeBinding
    && (memory.status === "ready" || memory.status === "unbound")
  );
}
