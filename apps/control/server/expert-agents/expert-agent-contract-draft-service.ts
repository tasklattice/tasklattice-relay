import { randomUUID } from "node:crypto";
import {
  expertAgentContractDraftSchema,
  expertAgentTeamSuggestionsSchema,
  type ExpertAgentContractDraft,
  type ExpertAgentContractDraftResult,
  type ExpertAgentTeamSuggestions,
  type KnowledgeSourceDefinition,
  type McpServerDefinition,
} from "@tali/contracts";
import type { ModelDeployment, ModelRouting } from "@tali/contracts";
import { prisma } from "../db/prisma";
import {
  HindsightProjectInferenceError,
  resolveHindsightChatTarget,
} from "../hindsight-inference/hindsight-inference-gateway";
import { LiteLLMClient } from "../providers/litellm-client";
import { ProjectStore } from "../projects/project-store";
import { ProjectQuotaService } from "../quotas/project-quota-service";
import { structuredProjectCompletion } from "./structured-project-completion";

const contractDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "purpose",
    "targetUsers",
    "capabilities",
    "outOfScope",
    "delegationGuidance",
    "expectedInputs",
    "expectedOutputs",
    "executionMode",
    "policy",
  ],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    purpose: { type: "string", minLength: 1, maxLength: 4_000 },
    targetUsers: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
    capabilities: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    outOfScope: {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    delegationGuidance: {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    expectedInputs: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    expectedOutputs: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    executionMode: { type: "string", enum: ["AGENTIC", "WORKFLOW"] },
    policy: {
      type: "object",
      additionalProperties: false,
      required: ["preset", "groundingPolicy", "outputMode", "actionPolicy"],
      properties: {
        preset: { type: "string", enum: ["FLEXIBLE", "CONTROLLED"] },
        groundingPolicy: {
          type: "string",
          enum: ["OPTIONAL", "REQUIRED", "TOOL_GROUNDED"],
        },
        outputMode: {
          type: "string",
          enum: ["FREEFORM", "STRUCTURED", "PATCHABLE"],
        },
        actionPolicy: {
          type: "string",
          enum: ["OPEN", "ALLOWLIST", "APPROVAL"],
        },
      },
    },
  },
} satisfies Record<string, unknown>;

interface SuggestionCandidate {
  id: string;
  name: string;
  ready: boolean;
  searchable: string;
}

interface DraftInventory {
  models: ModelDeployment[];
  routings: ModelRouting[];
  mcpServers?: McpServerDefinition[];
  knowledge?: KnowledgeSourceDefinition[];
  experts?: SuggestionCandidate[];
}

interface DraftDependencies {
  complete(input: {
    baseUrl: string;
    secret: string;
    model: string;
    intention: string;
  }): Promise<unknown>;
  inventory(projectId: string, actorId: string): Promise<DraftInventory>;
  issueProjectKey(input: {
    actorId: string;
    projectId: string;
    target: ReturnType<typeof resolveHindsightChatTarget>;
  }): Promise<{ baseUrl: string; secret: string }>;
}

const emptySuggestions: ExpertAgentTeamSuggestions = {
  knowledge: [],
  tools: [],
  experts: [],
};

function searchTerms(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2))];
}

function candidateScore(candidate: SuggestionCandidate, terms: string[]): number {
  const searchable = candidate.searchable.toLocaleLowerCase();
  return terms.reduce((score, term) => score + (searchable.includes(term) ? 1 : 0), 0);
}

function rankedSuggestions(input: {
  candidates: SuggestionCandidate[];
  includeReadyFallback: boolean;
  kind: "KNOWLEDGE" | "TOOL" | "EXPERT";
  terms: string[];
}) {
  return input.candidates
    .map((candidate) => ({ candidate, score: candidateScore(candidate, input.terms) }))
    .filter(({ candidate, score }) => score > 0 || (input.includeReadyFallback && candidate.ready))
    .sort((left, right) =>
      Number(right.candidate.ready) - Number(left.candidate.ready)
      || right.score - left.score
      || left.candidate.name.localeCompare(right.candidate.name)
    )
    .slice(0, 3)
    .map(({ candidate, score }) => ({
      kind: input.kind,
      id: candidate.id,
      name: candidate.name,
      ready: candidate.ready,
      reason: score > 0
        ? "Matches the declared intention or Contract. Review before attaching."
        : "Available in this Project and relevant to the selected reliability policy.",
    }));
}

function teamSuggestions(
  inventory: DraftInventory,
  intention: string,
  draft?: ExpertAgentContractDraft,
): ExpertAgentTeamSuggestions {
  const terms = searchTerms([
    intention,
    draft?.purpose ?? "",
    ...(draft?.capabilities ?? []),
    ...(draft?.delegationGuidance ?? []),
    ...(draft?.expectedInputs ?? []),
    ...(draft?.expectedOutputs ?? []),
  ].join(" "));
  const knowledge = (inventory.knowledge ?? []).map((resource) => ({
    id: resource.id,
    name: resource.name,
    ready: resource.status === "REGISTERED",
    searchable: `${resource.name} ${resource.description}`,
  }));
  const tools = (inventory.mcpServers ?? []).map((resource) => ({
    id: resource.id,
    name: resource.name,
    ready: resource.status === "HEALTHY",
    searchable: [
      resource.name,
      ...resource.tools.flatMap((tool) => [tool.name, tool.title ?? "", tool.description ?? ""]),
    ].join(" "),
  }));
  return expertAgentTeamSuggestionsSchema.parse({
    knowledge: rankedSuggestions({
      candidates: knowledge,
      includeReadyFallback: draft?.policy.groundingPolicy === "REQUIRED",
      kind: "KNOWLEDGE",
      terms,
    }),
    tools: rankedSuggestions({
      candidates: tools,
      includeReadyFallback: draft?.policy.groundingPolicy === "TOOL_GROUNDED",
      kind: "TOOL",
      terms,
    }),
    experts: rankedSuggestions({
      candidates: inventory.experts ?? [],
      includeReadyFallback: false,
      kind: "EXPERT",
      terms,
    }),
  });
}

function draftingPrompt(intention: string): string {
  return [
    "Turn the user's software intention into a concise Expert Agent product Contract.",
    "Describe product behavior, boundaries, delegation guidance, expected business inputs and outputs, and independent control policies; do not invent credentials, data sources, tools, model IDs, or implementation artifacts.",
    "FLEXIBLE and CONTROLLED are starting presets only, never exclusive Agent types.",
    "Prefer AGENTIC for bounded reasoning where evidence-backed variation is acceptable. Prefer WORKFLOW when deterministic branches, strict grounding, approvals, or low hallucination tolerance dominate.",
    "Use TOOL_GROUNDED when factual answers must come from a declared tool; REQUIRED when approved knowledge evidence is mandatory; OPTIONAL only when ungrounded creative output is explicitly acceptable.",
    "Return capabilities as observable outcomes and outOfScope as explicit non-goals.",
    `User intention:\n${intention}`,
  ].join("\n\n");
}

async function completeContractDraft(input: {
  baseUrl: string;
  secret: string;
  model: string;
  intention: string;
}): Promise<unknown> {
  return structuredProjectCompletion({
    baseUrl: input.baseUrl,
    secret: input.secret,
    model: input.model,
    operation: "Agent Contract draft",
    messages: [
      {
        role: "system",
        content: "You are TaskLattice Relay's Expert Agent product architect. Return only the requested JSON object.",
      },
      { role: "user", content: draftingPrompt(input.intention) },
    ],
    temperature: 0.1,
    maxTokens: 2_000,
    schemaName: "expert_agent_contract_draft",
    schema: contractDraftJsonSchema,
  });
}

function defaultDependencies(): DraftDependencies {
  const litellm = new LiteLLMClient();
  const db = prisma();
  return {
    complete: completeContractDraft,
    async inventory(projectId, actorId) {
      const store = new ProjectStore(projectId);
      const [models, routings, mcpServers, knowledge, expertRelations] = await Promise.all([
        store.listModelDeployments(),
        store.listModelRoutings(),
        store.listMcpServerDefinitions(),
        store.listKnowledgeSourceDefinitions(),
        db.expertAgentMemberRecord.findMany({
          where: {
            projectId,
            userId: actorId,
            relation: { in: ["OWNER", "MAINTAINER"] },
            agent: { deletedAt: null },
          },
          include: {
            agent: {
              include: {
                runtimeInstances: {
                  where: { kind: "PROJECT_AGENT", deletedAt: null },
                  select: { payload: true },
                },
              },
            },
          },
          orderBy: { agent: { updatedAt: "desc" } },
          take: 50,
        }),
      ]);
      return {
        models,
        routings,
        mcpServers,
        knowledge,
        experts: expertRelations.map(({ agent }) => ({
          id: agent.id,
          name: agent.name,
          ready: agent.runtimeInstances.some((instance) => {
            const payload = instance.payload;
            return Boolean(
              payload
              && typeof payload === "object"
              && !Array.isArray(payload)
              && (payload as { status?: unknown }).status === "READY",
            );
          }),
          searchable: `${agent.name} ${agent.description}`,
        })),
      };
    },
    async issueProjectKey({ actorId, projectId, target }) {
      const store = new ProjectStore(projectId);
      const quotas = new ProjectQuotaService(store, litellm);
      await quotas.sync();
      const { key } = await quotas.createInstanceKey({
        alias: `tali-agent-contract-draft-${projectId.slice(0, 48)}-${randomUUID()}`,
        duration: "15m",
        models: [target.model],
        ...(target.aliases ? { aliases: target.aliases } : {}),
        ...(target.routerSettings ? { routerSettings: target.routerSettings } : {}),
        metadata: {
          managed_by: "tali",
          tali_feature: "expert_agent_contract_draft",
          tali_project_id: projectId,
          tali_actor_id: actorId,
          tali_source_id: target.sourceId,
          tali_source_kind: target.sourceKind,
        },
        objectPermissions: { mcpServers: [] },
      });
      return { baseUrl: await litellm.connectionBaseUrl(), secret: key.secret };
    },
  };
}

function unavailable(
  error: HindsightProjectInferenceError,
  suggestions: ExpertAgentTeamSuggestions,
): ExpertAgentContractDraftResult {
  const ambiguous = error.code === "ambiguous_project_model"
    || error.code === "ambiguous_project_routing";
  const required = error.code === "chat_model_required";
  return {
    status: "UNAVAILABLE",
    reasonCode: required
      ? "PROJECT_MODEL_REQUIRED"
      : ambiguous
        ? "PROJECT_MODEL_AMBIGUOUS"
        : "PROJECT_MODEL_UNAVAILABLE",
    message: required
      ? "This Project has no READY default model routing or validated chat Model. Continue manually, or ask a Project Administrator to configure one."
      : ambiguous
        ? "This Project has more than one eligible chat Model and no unambiguous default. Continue manually, or ask a Project Administrator to choose a default."
        : "The Project default model route is not ready. Continue manually, or ask a Project Administrator to repair the route.",
    manualFallbackAllowed: true,
    suggestions,
  };
}

export class ExpertAgentContractDraftService {
  constructor(private readonly dependencies: DraftDependencies = defaultDependencies()) {}

  async draft(input: {
    actorId: string;
    intention: string;
    projectId: string;
  }): Promise<ExpertAgentContractDraftResult> {
    const inventory = await this.dependencies.inventory(input.projectId, input.actorId);
    const fallbackSuggestions = teamSuggestions(inventory, input.intention);
    let target: ReturnType<typeof resolveHindsightChatTarget>;
    try {
      target = resolveHindsightChatTarget(inventory.models, inventory.routings);
    } catch (error) {
      if (error instanceof HindsightProjectInferenceError) {
        return unavailable(error, fallbackSuggestions);
      }
      throw error;
    }
    const credentials = await this.dependencies.issueProjectKey({
      actorId: input.actorId,
      projectId: input.projectId,
      target,
    });
    const draft = expertAgentContractDraftSchema.parse(
      await this.dependencies.complete({
        ...credentials,
        model: target.model,
        intention: input.intention,
      }),
    );
    return {
      status: "GENERATED",
      draft,
      suggestions: teamSuggestions(inventory, input.intention, draft),
      source: { kind: target.sourceKind, id: target.sourceId },
    };
  }
}
