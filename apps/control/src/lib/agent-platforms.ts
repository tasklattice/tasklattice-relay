import {
  agentPlatforms,
  defaultAgentPlatformId,
  type AgentPlatformId,
} from "@tali/contracts";

export const agentPlatformBrandAssets: Record<AgentPlatformId, string> = {
  openclaw: "/assets/brands/openclaw-lobehub.webp",
  hermes: "/assets/brands/hermesagent-lobehub.webp",
  deepagents: "/assets/agent-providers/langgraph.png",
  pi: "/assets/brands/pi-logo-on-dark.svg",
};

export const agentRuntimePresentation = {
  name: "OpenShell",
  description: "Sandbox execution and isolation runtime",
} as const;

export const agentConfigurationPresentation = {
  name: "NemoClaw",
  description: "Configures the selected Agent inside OpenShell",
} as const;

export const agentPlatformPresentations = agentPlatforms.map((platform) => ({
  ...platform,
  brandAsset: agentPlatformBrandAssets[platform.id],
  configurationLabel: `${agentConfigurationPresentation.name} configuration`,
  configurationName: agentConfigurationPresentation.name,
  consoleLabel: `${platform.name} Console`,
  runtimeName: agentRuntimePresentation.name,
}));

export type AgentPlatformPresentation =
  (typeof agentPlatformPresentations)[number];

export function getAgentPlatformPresentation(
  id: AgentPlatformId = defaultAgentPlatformId,
): AgentPlatformPresentation {
  return (
    agentPlatformPresentations.find((platform) => platform.id === id) ??
    agentPlatformPresentations[0]!
  );
}
