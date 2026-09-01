import type {
  ExpertAgentContractDraft,
  ExpertAgentExecutionMode,
  ExpertAgentDefinitionInput,
  ExpertAgentPolicyProfile,
  ExpertAgentProductPreset,
} from "@tali/contracts";

export type AgenticFrameworkPreference =
  | "AUTO"
  | "GOOGLE_ADK"
  | "OPENAI_AGENTS_SDK"
  | "LANGGRAPH"
  | "CUSTOM_A2A";

export type AgentRuntimeMode =
  | "PLATFORM_MANAGED"
  | "HOSTED_CONTAINER"
  | "EXTERNAL_A2A";

export interface DelegatedAgentBrief {
  name: string;
  purpose: string;
  targetUsers: string[];
  capabilities: string[];
  outOfScope: string[];
  delegationGuidance?: string[];
  expectedInputs?: string[];
  expectedOutputs?: string[];
  executionMode: ExpertAgentExecutionMode;
  runtimeMode?: AgentRuntimeMode;
  policy?: ExpertAgentPolicyProfile;
  agenticFrameworkPreference?: AgenticFrameworkPreference;
}

export interface InitialAgentDefinitionInput {
  draft?: ExpertAgentContractDraft;
  executionMode: ExpertAgentExecutionMode;
  name: string;
  purpose: string;
}

export function isInitialAgentDefinitionReady(
  input: Pick<InitialAgentDefinitionInput, "name" | "purpose">,
): boolean {
  return Boolean(input.name.trim() && input.purpose.trim().length >= 20);
}

const frameworkNames: Record<AgenticFrameworkPreference, string> = {
  AUTO: "platform-selected-agent-sdk",
  GOOGLE_ADK: "google-adk",
  OPENAI_AGENTS_SDK: "openai-agents-sdk",
  LANGGRAPH: "langgraph",
  CUSTOM_A2A: "custom-a2a-service",
};

export function policyForPreset(
  preset: ExpertAgentProductPreset,
): ExpertAgentPolicyProfile {
  return preset === "CONTROLLED"
    ? {
        preset,
        groundingPolicy: "REQUIRED",
        outputMode: "STRUCTURED",
        actionPolicy: "APPROVAL",
      }
    : {
        preset,
        groundingPolicy: "TOOL_GROUNDED",
        outputMode: "STRUCTURED",
        actionPolicy: "ALLOWLIST",
      };
}

export function slugifyExpertAgentName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || `expert-agent-${Date.now()}`;
}

function createBaseDefinition(brief: DelegatedAgentBrief) {
  const primaryCapability = brief.capabilities[0]
    ?? "Fulfil the delegated product capability through A2A";

  return {
    expectedRevision: 0,
    product: {
      name: brief.name,
      purpose: brief.purpose,
      targetUsers: brief.targetUsers,
      capabilities: brief.capabilities,
      outOfScope: brief.outOfScope,
      delegationGuidance: brief.delegationGuidance ?? [],
      inputContract: {
        type: "object",
        description: brief.expectedInputs?.join("; ")
          ?? "A business request and optional structured context.",
        "x-tali-expected-inputs": brief.expectedInputs ?? [],
        properties: {
          text: { type: "string", minLength: 1 },
          context: { type: "object", additionalProperties: true },
        },
        required: ["text"],
        additionalProperties: false,
      },
      outputContract: {
        type: "object",
        description: brief.expectedOutputs?.join("; ")
          ?? "A traceable Agent outcome and its result or evidence.",
        "x-tali-expected-outputs": brief.expectedOutputs ?? [],
        properties: {
          outcome: {
            type: "string",
            enum: [
              "COMPLETED",
              "NEED_MORE_INFORMATION",
              "UNKNOWN",
              "ESCALATED",
              "REJECTED",
            ],
          },
          text: { type: "string" },
          citations: { type: "array" },
          data: { type: "object" },
        },
        required: ["outcome", "text", "citations"],
        additionalProperties: true,
      },
    },
    policy: brief.policy ?? policyForPreset(
      brief.executionMode === "WORKFLOW" ? "CONTROLLED" : "FLEXIBLE",
    ),
    delegations: [],
    acceptance: {
      minimumRequiredPassRate: 1,
      cases: [
        {
          id: "primary-product-outcome",
          title: "Delivers the primary product outcome",
          kind: "HAPPY_PATH" as const,
          given: `A valid A2A request from ${brief.targetUsers.join(", ")}`,
          when: `The Agent is asked to: ${primaryCapability}`,
          then: [
            "The response conforms to the declared output contract",
            "The outcome is traceable to the exact Agent Version and execution evidence",
          ],
          required: true,
          request: { text: `Execute: ${primaryCapability}` },
          assertions: [
            { type: "STATUS" as const, expected: "ANSWER" as const },
            {
              type: "CITATIONS" as const,
              required: (brief.policy ?? policyForPreset(
                brief.executionMode === "WORKFLOW" ? "CONTROLLED" : "FLEXIBLE",
              )).groundingPolicy !== "OPTIONAL",
            },
            {
              type: "OUTPUT_SCHEMA" as const,
              schema: {
                type: "object",
                required: ["outcome", "text", "citations"],
              },
            },
            ...(brief.executionMode === "AGENTIC" ? [{
              type: "SEMANTIC_QUALITY" as const,
              rubric: `The response materially delivers this capability without inventing unsupported facts: ${primaryCapability}`,
              minimumScore: 0.8,
            }] : []),
          ],
        },
      ],
      suites: [{
        id: "publish-regression",
        name: "Publish regression",
        description: "Required product outcome, grounding, and output-contract gates.",
        required: true,
        caseIds: ["primary-product-outcome"],
      }],
    },
    safety: {
      guardrails: [
        {
          id: "no-unsupported-claims",
          category: "GROUNDING" as const,
          rule: "Do not present unsupported or unverified information as fact.",
          violationBehavior: "UNKNOWN" as const,
          required: true,
        },
      ],
      prohibitedBehaviors: [
        "Claiming success when required evidence, tools, or approved data are unavailable",
      ],
      noEvidenceBehavior: "UNKNOWN" as const,
      allowGeneralModelFallback: false,
    },
    resources: [],
  };
}

export function createAgentDefinition(
  brief: DelegatedAgentBrief,
): ExpertAgentDefinitionInput {
  const base = createBaseDefinition(brief);

  if (brief.executionMode === "AGENTIC") {
    const preference = brief.agenticFrameworkPreference ?? "AUTO";
    return {
      ...base,
      execution: {
        mode: "AGENTIC",
        engine: {
          framework: frameworkNames[preference],
          version: "design",
        },
        modelRoutingId: "unassigned-model-routing",
        instruction: "Reason and respond using the request context and resources bound to this Agent.",
        configuration: {
          engineType: "DELEGATED_AGENT_DESIGN",
          developmentStatus: "DESIGN",
          frameworkPreference: preference,
          runtimeMode: brief.runtimeMode ?? "PLATFORM_MANAGED",
          a2aExposure: "REQUIRED",
        },
        maxSteps: 12,
        timeoutMs: 120_000,
      },
    };
  }

  return {
    ...base,
    execution: {
      mode: "WORKFLOW",
      engine: {
        framework: "tasklattice-flow",
        version: "design",
      },
      entrypoint: "receive-request",
      configuration: {
        engineType: "DELEGATED_WORKFLOW_DESIGN",
        developmentStatus: "DESIGN",
        runtimeMode: brief.runtimeMode ?? "PLATFORM_MANAGED",
        a2aExposure: "REQUIRED",
        defaultNoEvidenceOutcome: "UNKNOWN",
      },
      nodes: [
        {
          id: "receive-request",
          type: "NORMALIZE_INPUT",
          configuration: {
            designPlaceholder: true,
            description: "Validate and normalize the A2A request.",
          },
        },
        {
          id: "end-design",
          type: "END",
          configuration: {
            designPlaceholder: true,
            outcome: "UNKNOWN",
          },
        },
      ],
      transitions: [
        {
          from: "receive-request",
          outcome: "NORMALIZED",
          to: "end-design",
        },
      ],
      timeoutMs: 30_000,
    },
  };
}

/**
 * Builds the first editable definition created from the compact Agent form.
 * The developer-owned identity, purpose, and build method always win over a
 * model-generated draft. The draft may only enrich the editable starting
 * contract with users, capabilities, boundaries, and IO expectations.
 */
export function createInitialAgentDefinition(
  input: InitialAgentDefinitionInput,
): ExpertAgentDefinitionInput {
  const purpose = input.purpose.trim();
  const draft = input.draft;
  return createAgentDefinition({
    name: input.name.trim(),
    purpose,
    executionMode: input.executionMode,
    targetUsers: draft?.targetUsers.length
      ? draft.targetUsers
      : ["Project users"],
    capabilities: draft?.capabilities.length
      ? draft.capabilities
      : [purpose],
    outOfScope: draft?.outOfScope ?? [
      "Actions outside the declared purpose or granted Project resources",
    ],
    delegationGuidance: draft?.delegationGuidance ?? [],
    expectedInputs: draft?.expectedInputs.length
      ? draft.expectedInputs
      : ["A business request and optional structured context"],
    expectedOutputs: draft?.expectedOutputs.length
      ? draft.expectedOutputs
      : ["A traceable Agent outcome with status, result, and evidence"],
    policy: policyForPreset(
      input.executionMode === "WORKFLOW" ? "CONTROLLED" : "FLEXIBLE",
    ),
    runtimeMode: "PLATFORM_MANAGED",
    ...(input.executionMode === "AGENTIC"
      ? { agenticFrameworkPreference: "AUTO" as const }
      : {}),
  });
}
