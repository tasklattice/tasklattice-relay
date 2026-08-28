export const agentPlatformIds = ["hermes", "openclaw", "deepagents"] as const;

export type AgentPlatformId = (typeof agentPlatformIds)[number];

export interface AgentPlatformCapabilities {
  acceptsDelegation: boolean;
  canDelegate: boolean;
  embeddedRunTelemetry: boolean;
  interactive: boolean;
  memory: "native" | "native-hybrid" | "none";
}

export interface AgentPlatformDefinition {
  capabilities: AgentPlatformCapabilities;
  catalog: {
    category: string;
    description: string;
    id: string;
    name: string;
    specializationId: string | null;
    tags: readonly string[];
  };
  description: string;
  endpointLabel: string;
  id: AgentPlatformId;
  interactionSurface: "web-ui" | "terminal";
  isDefault: boolean;
  name: string;
  sandboxImage: string;
  terminalLabel: string;
}

export const agentPlatforms = [
  {
    id: "hermes",
    name: "Hermes",
    description: "Self-improving Agent with durable memory and a learning loop.",
    terminalLabel: "Hermes TUI",
    endpointLabel: "Hermes dashboard",
    interactionSurface: "web-ui",
    isDefault: true,
    sandboxImage: "ghcr.io/tasklattice/tali-nemoclaw-hermes-sandbox:dev",
    capabilities: {
      interactive: true,
      canDelegate: true,
      acceptsDelegation: false,
      embeddedRunTelemetry: true,
      memory: "native",
    },
    catalog: {
      id: "hermes-deep-researcher",
      name: "Hermes Deep Researcher",
      description:
        "Investigates complex questions with durable memory, evidence gathering, and synthesis.",
      category: "Research",
      tags: ["Research", "RAG", "Memory"],
      specializationId: "research-analyst",
    },
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    description: "Gateway-based Agent with a plugin ecosystem and browser UI.",
    terminalLabel: "OpenClaw TUI",
    endpointLabel: "OpenClaw Web UI",
    interactionSurface: "web-ui",
    isDefault: false,
    sandboxImage: "ghcr.io/tasklattice/tali-nemoclaw-sandbox:dev",
    capabilities: {
      interactive: true,
      canDelegate: true,
      acceptsDelegation: false,
      embeddedRunTelemetry: true,
      memory: "native-hybrid",
    },
    catalog: {
      id: "openclaw-generalist",
      name: "OpenClaw Generalist",
      description:
        "A general-purpose interactive Agent for browser tasks, terminal work, and multi-step automation.",
      category: "General",
      tags: ["Automation", "Browser", "Coding"],
      specializationId: "general-purpose",
    },
  },
  {
    id: "deepagents",
    name: "Deep Agents Code",
    description: "Terminal coding Agent built on the LangChain Deep Agents SDK.",
    terminalLabel: "Deep Agents TUI",
    endpointLabel: "No Web UI",
    interactionSurface: "terminal",
    isDefault: false,
    sandboxImage: "ghcr.io/tasklattice/tali-nemoclaw-deepagents-sandbox:dev",
    capabilities: {
      interactive: true,
      canDelegate: true,
      acceptsDelegation: false,
      embeddedRunTelemetry: false,
      memory: "none",
    },
    catalog: {
      id: "deepagents-code",
      name: "Deep Agents Code",
      description:
        "A repository-native coding Supervisor powered by the LangChain Deep Agents SDK.",
      category: "Developer Tools",
      tags: ["Coding", "Repository", "Terminal"],
      specializationId: "devops-engineer",
    },
  },
] as const satisfies readonly AgentPlatformDefinition[];

export type AgentPlatform = (typeof agentPlatforms)[number];

export const defaultAgentPlatformId = agentPlatforms.find(
  (platform) => platform.isDefault,
)!.id;

export function getAgentPlatformDefinition(
  id: AgentPlatformId,
): AgentPlatformDefinition {
  return agentPlatforms.find((platform) => platform.id === id)!;
}

export function isAgentPlatformId(value: string): value is AgentPlatformId {
  return (agentPlatformIds as readonly string[]).includes(value);
}

export function mapAgentPlatforms<Value>(
  select: (platform: AgentPlatformDefinition) => Value,
): Record<AgentPlatformId, Value> {
  return Object.fromEntries(
    agentPlatforms.map((platform) => [platform.id, select(platform)]),
  ) as Record<AgentPlatformId, Value>;
}
