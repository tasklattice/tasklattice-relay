import {
  agentGardenEntrySchema,
  type AgentGardenEntry,
} from "@tali/contracts";
import {
  demoAgentCardUrl,
  demoAgentDefinitions,
  demoAgentEndpoint,
  demoTestImageReference,
  hermesMvpA2aAgentIds,
} from "./demo-agent-runtime";
import { marketplaceMetadataFor } from "./marketplace-agent-metadata";

export const agentCatalogSeedVersion = "2026-08-31.1";
const seededAt = "2026-08-23T00:00:00.000Z";
const managedDemoAgentIds = new Set<string>(hermesMvpA2aAgentIds);

export const databaseAgentCatalog: AgentGardenEntry[] =
  demoAgentDefinitions.map((definition, index) => {
    const catalogKind =
      definition.catalogKind ?? "TALI_DEMO";
    const managedDemo = managedDemoAgentIds.has(definition.id);
    return agentGardenEntrySchema.parse({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      source: "BUILT_IN",
      integrationType: definition.integrationType,
      platformLabel: definition.platformLabel,
      category: definition.category,
      owner:
        catalogKind === "EXAMPLE_BLUEPRINT"
          ? "TaskLattice Relay Example Store"
          : "TaskLattice Relay Demo",
      tags: definition.tags,
      status: "READY",
      usageMode: "CALLABLE",
      usageCapabilities: {
        interactive: false,
        canDelegate: false,
        acceptsDelegation: true,
      },
      endpoint: demoAgentEndpoint(definition.id),
      agentCardUrl: demoAgentCardUrl(definition.id),
      a2a: {
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
        tenant: null,
        streaming: false,
        pushNotifications: false,
        extendedAgentCard: false,
        defaultInputModes: ["text/plain"],
        defaultOutputModes: ["text/plain"],
      },
      authType: "none",
      authReference: "",
      internalNetworkOnly: true,
      configuration: {
        catalogKind,
        catalogOrder: String(index),
        catalogVersion: agentCatalogSeedVersion,
        previewMode: "DETERMINISTIC",
        framework: definition.framework ?? "A2A SDK",
        icon: definition.icon ?? "",
        language: definition.language ?? "TypeScript",
        examplePrompt1: definition.examplePrompts[0] ?? "",
        examplePrompt2: definition.examplePrompts[1] ?? "",
        workflow: JSON.stringify(definition.trace),
        marketplaceBrief: JSON.stringify(
          marketplaceMetadataFor(definition),
        ),
        marketplaceVersion: "1.0.0-preview",
        releaseStage: "Preview",
        supportLevel: "TaskLattice Relay sample catalog",
        license: "Sample blueprint",
        transport: "A2A 1.0 / JSON-RPC",
        ...(managedDemo
          ? {
              onboardingSource: "CONTAINER_IMAGE",
              imageReference: demoTestImageReference(),
              containerPort: "3000",
              agentCardPath: "/.well-known/agent-card.json",
              imagePullSecretName: "",
              command: "[]",
              args: JSON.stringify(["a2a", definition.id]),
              runtimeOwnership: "PROJECT_MANAGED_INSTANCE",
            }
          : {}),
      },
      skills: definition.skills,
      specializationId: null,
      createdAt: seededAt,
      updatedAt: seededAt,
      lastDiscoveredAt: null,
      lastDiscoveryError: null,
    });
  });
