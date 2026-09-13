import { randomUUID } from "node:crypto";
import {
  expertAgentDraftTryInputSchema,
  expertAgentDraftTryResultSchema,
  type ExpertAgentDraftTryInput,
  type ExpertAgentDraftTryResult,
  type ModelDeployment,
  type ModelRouting,
} from "@tali/contracts";
import { z } from "zod";
import {
  HindsightProjectInferenceError,
  resolveHindsightChatTarget,
} from "../hindsight-inference/hindsight-inference-gateway";
import { LiteLLMClient } from "../providers/litellm-client";
import { ProjectStore } from "../projects/project-store";
import { ProjectQuotaService } from "../quotas/project-quota-service";
import { structuredProjectCompletion } from "./structured-project-completion";

interface DraftTryDependencies {
  complete(input: {
    answerContract: ExpertAgentDraftTryInput;
    baseUrl: string;
    model: string;
    secret: string;
  }): Promise<{ outcome: "ANSWER" | "ESCALATE" | "CLARIFY"; answer: string }>;
  inventory(projectId: string): Promise<{
    models: ModelDeployment[];
    routings: ModelRouting[];
  }>;
  issueProjectKey(input: {
    actorId: string;
    projectId: string;
    target: ReturnType<typeof resolveHindsightChatTarget>;
  }): Promise<{ baseUrl: string; secret: string }>;
}

const draftTryJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "answer"],
  properties: {
    outcome: { type: "string", enum: ["ANSWER", "ESCALATE", "CLARIFY"] },
    answer: { type: "string", minLength: 1, maxLength: 32_000 },
  },
} satisfies Record<string, unknown>;

const draftTryCompletionSchema = z.object({
  outcome: z.enum(["ANSWER", "ESCALATE", "CLARIFY"]),
  answer: z.string().trim().min(1).max(32_000),
}).strict();

async function structuredPreview(input: {
  answerContract: ExpertAgentDraftTryInput;
  baseUrl: string;
  model: string;
  secret: string;
}): Promise<{ outcome: "ANSWER" | "ESCALATE" | "CLARIFY"; answer: string }> {
  const completion = await structuredProjectCompletion({
    baseUrl: input.baseUrl,
    secret: input.secret,
    model: input.model,
    operation: "Agent draft preview",
    messages: [
      {
        role: "system",
        content: [
          "You are simulating an unpublished TaskLattice Agent Contract for a Developer preview.",
          "Follow the Contract boundaries exactly. Do not claim to have tools, knowledge, credentials, deployment, memory, or external facts.",
          "If the request needs missing information, return CLARIFY. If it needs a human or disallowed action, return ESCALATE.",
          `Contract: ${JSON.stringify(input.answerContract.contract)}`,
        ].join("\n\n"),
      },
      { role: "user", content: input.answerContract.message },
    ],
    temperature: 0.2,
    maxTokens: 1_200,
    schemaName: "expert_agent_draft_try",
    schema: draftTryJsonSchema,
  });
  return draftTryCompletionSchema.parse(completion);
}

function unavailable(error: HindsightProjectInferenceError): ExpertAgentDraftTryResult {
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
      ? "This Project has no READY default chat Model for draft testing. Configure one, or accept the Contract and test after resources are attached."
      : ambiguous
        ? "This Project has no unambiguous default chat Model for draft testing. Ask a Project Administrator to select one."
        : "The Project default chat Model is unavailable. Retry after its routing is healthy.",
    retryable: !required,
    persisted: false,
  };
}

function defaultDependencies(): DraftTryDependencies {
  const litellm = new LiteLLMClient();
  return {
    complete: structuredPreview,
    async inventory(projectId) {
      const store = new ProjectStore(projectId);
      const [models, routings] = await Promise.all([
        store.listModelDeployments(),
        store.listModelRoutings(),
      ]);
      return { models, routings };
    },
    async issueProjectKey({ actorId, projectId, target }) {
      const store = new ProjectStore(projectId);
      const quotas = new ProjectQuotaService(store, litellm);
      await quotas.sync();
      const { key } = await quotas.createInstanceKey({
        alias: `tali-agent-draft-try-${projectId.slice(0, 48)}-${randomUUID()}`,
        duration: "15m",
        models: [target.model],
        ...(target.aliases ? { aliases: target.aliases } : {}),
        ...(target.routerSettings ? { routerSettings: target.routerSettings } : {}),
        metadata: {
          managed_by: "tali",
          tali_feature: "expert_agent_draft_try",
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

export class ExpertAgentDraftTryService {
  constructor(private readonly dependencies: DraftTryDependencies = defaultDependencies()) {}

  async run(input: {
    actorId: string;
    projectId: string;
    value: ExpertAgentDraftTryInput;
  }): Promise<ExpertAgentDraftTryResult> {
    const value = expertAgentDraftTryInputSchema.parse(input.value);
    if (value.contract.policy.groundingPolicy !== "OPTIONAL") {
      return {
        status: "COMPLETED",
        outcome: "ABSTAIN",
        answer: "This draft has no authoritative Knowledge or Tool evidence attached yet, so its grounding policy prevents a factual answer. Create the Agent, attach an approved resource in Develop, and test again.",
        source: "POLICY_SIMULATION",
        persisted: false,
        evidence: [{ kind: "USER_INPUT", label: "Draft test message only; no authoritative business evidence attached" }],
      };
    }

    const inventory = await this.dependencies.inventory(input.projectId);
    let target: ReturnType<typeof resolveHindsightChatTarget>;
    try {
      target = resolveHindsightChatTarget(inventory.models, inventory.routings);
    } catch (error) {
      if (error instanceof HindsightProjectInferenceError) return unavailable(error);
      throw error;
    }
    const credentials = await this.dependencies.issueProjectKey({
      actorId: input.actorId,
      projectId: input.projectId,
      target,
    });
    const result = await this.dependencies.complete({
      ...credentials,
      model: target.model,
      answerContract: value,
    });
    return expertAgentDraftTryResultSchema.parse({
      status: "COMPLETED",
      outcome: result.outcome,
      answer: result.answer,
      source: "PROJECT_MODEL",
      persisted: false,
      evidence: [
        { kind: "USER_INPUT", label: "Draft test message" },
        { kind: "PROJECT_MODEL", label: `${target.sourceKind}:${target.sourceId}` },
      ],
    });
  }
}
