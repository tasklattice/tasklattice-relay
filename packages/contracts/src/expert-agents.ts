import { z } from "zod";

export const expertAgentRelations = ["OWNER", "MAINTAINER"] as const;
export const expertAgentExecutionModes = ["AGENTIC", "WORKFLOW"] as const;
export const expertAgentProductPresets = ["FLEXIBLE", "CONTROLLED"] as const;
export const expertAgentGroundingPolicies = [
  "OPTIONAL",
  "REQUIRED",
  "TOOL_GROUNDED",
] as const;
export const expertAgentOutputModes = [
  "FREEFORM",
  "STRUCTURED",
  "PATCHABLE",
] as const;
export const expertAgentActionPolicies = [
  "OPEN",
  "ALLOWLIST",
  "APPROVAL",
] as const;
export const expertAgentDelegationPolicies = [
  "AUTOMATIC",
  "SUGGEST_ONLY",
] as const;
export const expertAgentDelegationExecutionPolicies = [
  "SYNCHRONOUS",
  "ASYNCHRONOUS",
] as const;
export const expertAgentDelegationApprovalPolicies = [
  "NOT_REQUIRED",
  "REQUIRED",
] as const;
export const expertAgentTestModes = ["QUICK", "RELEASE"] as const;
export const expertAgentTestStatuses = [
  "QUEUED",
  "RUNNING",
  "PASSED",
  "FAILED",
  "CANCELLED",
] as const;

export const expertAgentTryInputSchema = z.object({
  message: z.string().trim().min(1).max(32_000),
}).strict();

export const expertAgentTryResultSchema = z.object({
  traceId: z.string().trim().min(1).max(128),
  outcome: z.enum([
    "COMPLETED",
    "NEED_MORE_INFORMATION",
    "UNKNOWN",
    "ESCALATED",
    "REJECTED",
    "FAILED",
  ]),
  text: z.string().max(32_000),
  data: z.record(z.string(), z.unknown()),
  durationMs: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  knowledgeSourceCount: z.number().int().nonnegative(),
  citations: z.array(z.object({
    sourceId: z.string(),
    title: z.string(),
    uri: z.string().nullable(),
    excerpt: z.string().nullable(),
    revision: z.string().nullable(),
  }).strict()).max(500),
  trace: z.array(z.object({
    step: z.string(),
    status: z.enum(["STARTED", "COMPLETED", "FAILED", "SKIPPED"]),
    summary: z.string(),
    occurredAt: z.string().datetime(),
    attributes: z.record(
      z.string(),
      z.union([z.boolean(), z.number(), z.string(), z.null()]),
    ),
  }).strict()).max(2_000),
}).strict();

export type ExpertAgentRelation = (typeof expertAgentRelations)[number];
export type ExpertAgentExecutionMode =
  (typeof expertAgentExecutionModes)[number];
export type ExpertAgentProductPreset =
  (typeof expertAgentProductPresets)[number];
export type ExpertAgentTestMode = (typeof expertAgentTestModes)[number];
export type ExpertAgentTestStatus = (typeof expertAgentTestStatuses)[number];
export type ExpertAgentTryInput = z.infer<typeof expertAgentTryInputSchema>;
export type ExpertAgentTryResult = z.infer<typeof expertAgentTryResultSchema>;

const identifierSchema = z.string().trim().min(1).max(160).regex(
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  "Use a lowercase kebab-case identifier.",
);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const jsonSchemaSchema = z.record(z.string(), z.unknown());
const evaluationReferenceSchema = z.string().trim().min(1).max(500).regex(
  /^[A-Za-z][A-Za-z0-9._:-]*$/,
  "Use a stable node, block, source, or tool reference.",
);

export const expertAgentProductSpecSchema = z.object({
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(4_000),
  targetUsers: z.array(z.string().trim().min(1).max(240)).min(1).max(20),
  capabilities: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  outOfScope: z.array(z.string().trim().min(1).max(500)).max(100),
  delegationGuidance: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  inputContract: jsonSchemaSchema,
  outputContract: jsonSchemaSchema,
}).strict();

export const expertAgentPolicyProfileSchema = z.object({
  preset: z.enum(expertAgentProductPresets).default("FLEXIBLE"),
  groundingPolicy: z.enum(expertAgentGroundingPolicies).default("REQUIRED"),
  outputMode: z.enum(expertAgentOutputModes).default("STRUCTURED"),
  actionPolicy: z.enum(expertAgentActionPolicies).default("ALLOWLIST"),
}).strict();

export const defaultExpertAgentPolicyProfile = expertAgentPolicyProfileSchema.parse({});

export const expertAgentEvaluationAssertionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("STATUS"),
    expected: z.enum(["ANSWER", "ABSTAIN", "ESCALATE", "CLARIFY"]),
  }).strict(),
  z.object({
    type: z.literal("EXECUTION_PATH"),
    requiredNodeIds: z.array(evaluationReferenceSchema).max(200).default([]),
    forbiddenNodeIds: z.array(evaluationReferenceSchema).max(200).default([]),
  }).strict(),
  z.object({
    type: z.literal("CITATIONS"),
    required: z.boolean(),
    allowedSourceIds: z.array(z.string().trim().min(1).max(500)).max(500).optional(),
  }).strict(),
  z.object({
    type: z.literal("OUTPUT_SCHEMA"),
    schema: jsonSchemaSchema,
  }).strict(),
  z.object({
    type: z.literal("BLOCK_STABILITY"),
    changedBlockIds: z.array(evaluationReferenceSchema).max(500).default([]),
    unchangedBlockIds: z.array(evaluationReferenceSchema).max(500).default([]),
  }).strict(),
  z.object({
    type: z.literal("TOOL_INVOCATION"),
    toolName: z.string().trim().min(1).max(240),
    minimumCalls: z.number().int().min(0).max(1_000).default(1),
  }).strict(),
  z.object({
    type: z.literal("DELEGATION"),
    expertAgentId: z.string().uuid(),
    required: z.boolean().default(true),
  }).strict(),
  z.object({
    type: z.literal("CLAIMS"),
    requiredClaims: z.array(z.string().trim().min(1).max(2_000)).max(200).default([]),
    forbiddenClaims: z.array(z.string().trim().min(1).max(2_000)).max(200).default([]),
  }).strict(),
  z.object({
    type: z.literal("SEMANTIC_QUALITY"),
    rubric: z.string().trim().min(1).max(8_000),
    minimumScore: z.number().min(0).max(1),
  }).strict(),
  z.object({
    type: z.literal("SOURCE_COVERAGE"),
    requiredSourceIds: z.array(z.string().trim().min(1).max(500)).min(1).max(500),
  }).strict(),
]);

export const expertAgentAcceptanceCaseSchema = z.object({
  id: identifierSchema,
  title: z.string().trim().min(1).max(240),
  kind: z.enum(["HAPPY_PATH", "EDGE_CASE", "FAILURE_PATH"]),
  given: z.string().trim().min(1).max(4_000),
  when: z.string().trim().min(1).max(4_000),
  then: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
  required: z.boolean().default(true),
  request: z.record(z.string(), z.unknown()).optional(),
  assertions: z.array(expertAgentEvaluationAssertionSchema).min(1).max(200).optional(),
}).strict();

export const expertAgentEvaluationSuiteSchema = z.object({
  id: identifierSchema,
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(2_000),
  required: z.boolean().default(true),
  caseIds: z.array(identifierSchema).min(1).max(500),
}).strict().superRefine((value, context) => {
  if (new Set(value.caseIds).size !== value.caseIds.length) {
    context.addIssue({
      code: "custom",
      path: ["caseIds"],
      message: "An Evaluation case can appear only once in a Suite.",
    });
  }
});

export const expertAgentAcceptanceSpecSchema = z.object({
  cases: z.array(expertAgentAcceptanceCaseSchema).min(1).max(500),
  minimumRequiredPassRate: z.number().min(0).max(1).default(1),
  suites: z.array(expertAgentEvaluationSuiteSchema).min(1).max(100).optional(),
}).strict().superRefine((value, context) => {
  const ids = value.cases.map((testCase) => testCase.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      path: ["cases"],
      message: "Acceptance case IDs must be unique.",
    });
  }
  if (value.suites) {
    const suiteIds = value.suites.map((suite) => suite.id);
    if (new Set(suiteIds).size !== suiteIds.length) {
      context.addIssue({
        code: "custom",
        path: ["suites"],
        message: "Evaluation Suite IDs must be unique.",
      });
    }
    const knownCaseIds = new Set(ids);
    value.suites.forEach((suite, suiteIndex) => {
      suite.caseIds.forEach((caseId, caseIndex) => {
        if (!knownCaseIds.has(caseId)) {
          context.addIssue({
            code: "custom",
            path: ["suites", suiteIndex, "caseIds", caseIndex],
            message: `Evaluation case ${caseId} does not exist.`,
          });
        }
      });
    });
  }
});

export const expertAgentGuardrailSchema = z.object({
  id: identifierSchema,
  category: z.enum([
    "GROUNDING",
    "ACCESS_CONTROL",
    "DATA_HANDLING",
    "TOOL_USE",
    "CONTENT",
    "OPERATIONAL",
  ]),
  rule: z.string().trim().min(1).max(4_000),
  violationBehavior: z.enum([
    "REJECT",
    "UNKNOWN",
    "ESCALATE",
    "REQUIRE_CONFIRMATION",
  ]),
  required: z.boolean().default(true),
}).strict();

export const expertAgentSafetySpecSchema = z.object({
  guardrails: z.array(expertAgentGuardrailSchema).min(1).max(200),
  prohibitedBehaviors: z.array(z.string().trim().min(1).max(1_000)).min(1).max(200),
  noEvidenceBehavior: z.enum(["UNKNOWN", "ESCALATE", "REJECT"]),
  allowGeneralModelFallback: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  const ids = value.guardrails.map((guardrail) => guardrail.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      path: ["guardrails"],
      message: "Guardrail IDs must be unique.",
    });
  }
});

export const expertAgentResourceBindingSchema = z.object({
  kind: z.enum([
    "MCP_SERVER",
    "KNOWLEDGE_VECTOR_DATABASE",
    "MODEL_ROUTING",
    "SKILL",
    "DATA_SOURCE",
    "MEMORY",
  ]),
  resourceId: z.string().trim().min(1).max(240),
  revision: z.string().trim().min(1).max(240),
  access: z.enum(["READ", "INVOKE", "READ_WRITE"]),
  required: z.boolean().default(true),
}).strict();

export const expertAgentDelegationSchema = z.object({
  expertAgentId: z.string().uuid(),
  when: z.string().trim().min(1).max(2_000),
  delegationPolicy: z.enum(expertAgentDelegationPolicies).default("AUTOMATIC"),
  executionPolicy: z.enum(expertAgentDelegationExecutionPolicies).default("SYNCHRONOUS"),
  approvalPolicy: z.enum(expertAgentDelegationApprovalPolicies).default("NOT_REQUIRED"),
  enabled: z.boolean().default(true),
}).strict();

const expertAgentDelegationsSchema = z.array(expertAgentDelegationSchema)
  .max(100)
  .superRefine((value, context) => {
    const ids = value.map((delegation) => delegation.expertAgentId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "An A2A Agent can be attached only once.",
      });
    }
  });

const expertAgentEngineSchema = z.object({
  framework: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(120),
}).strict();

export const expertAgentAgenticExecutionSpecSchema = z.object({
  mode: z.literal("AGENTIC"),
  engine: expertAgentEngineSchema,
  modelRoutingId: z.string().trim().min(1).max(240),
  instruction: z.string().trim().min(1).max(32_000),
  configuration: z.record(z.string(), z.unknown()).default({}),
  maxSteps: z.number().int().min(1).max(100).default(12),
  timeoutMs: z.number().int().min(1_000).max(900_000).default(120_000),
}).strict();

export const expertAgentWorkflowNodeSchema = z.object({
  id: identifierSchema,
  type: z.enum([
    "REASON",
    "KNOWLEDGE",
    "TOOL",
    "TRANSFORM",
    "VERIFY",
    "DELEGATE",
    "APPROVAL",
    "RESPONSE",
    "NORMALIZE_INPUT",
    "CLASSIFY_INTENT",
    "RETRIEVE_EVIDENCE",
    "DECISION",
    "RENDER_TEMPLATE",
    "ESCALATE",
    "END",
  ]),
  configuration: z.record(z.string(), z.unknown()).default({}),
  inputSchema: jsonSchemaSchema.optional(),
  outputSchema: jsonSchemaSchema.optional(),
  timeoutMs: z.number().int().min(100).max(900_000).optional(),
  retry: z.object({
    maxAttempts: z.number().int().min(1).max(10),
    backoffMs: z.number().int().min(0).max(60_000),
  }).strict().optional(),
  failurePolicy: z.enum(["FAIL_RUN", "FOLLOW_FAILURE_EDGE"]).optional(),
}).strict();

export const expertAgentWorkflowTransitionSchema = z.object({
  from: identifierSchema,
  outcome: z.string().trim().min(1).max(120),
  to: identifierSchema,
}).strict();

export const expertAgentWorkflowExecutionSpecSchema = z.object({
  mode: z.literal("WORKFLOW"),
  engine: expertAgentEngineSchema,
  entrypoint: identifierSchema,
  configuration: z.record(z.string(), z.unknown()).default({}),
  nodes: z.array(expertAgentWorkflowNodeSchema).min(2).max(200),
  transitions: z.array(expertAgentWorkflowTransitionSchema).min(1).max(1_000),
  timeoutMs: z.number().int().min(1_000).max(900_000).default(30_000),
}).strict().superRefine((value, context) => {
  const nodeIds = value.nodes.map((node) => node.id);
  const knownNodeIds = new Set(nodeIds);
  if (knownNodeIds.size !== nodeIds.length) {
    context.addIssue({
      code: "custom",
      path: ["nodes"],
      message: "Workflow node IDs must be unique.",
    });
  }
  if (!knownNodeIds.has(value.entrypoint)) {
    context.addIssue({
      code: "custom",
      path: ["entrypoint"],
      message: "Workflow entrypoint must reference an existing node.",
    });
  }
  if (!value.nodes.some((node) => node.type === "END")) {
    context.addIssue({
      code: "custom",
      path: ["nodes"],
      message: "A Workflow must contain at least one END node.",
    });
  }
  value.transitions.forEach((transition, index) => {
    if (!knownNodeIds.has(transition.from)) {
      context.addIssue({
        code: "custom",
        path: ["transitions", index, "from"],
        message: "Transition source must reference an existing node.",
      });
    }
    if (!knownNodeIds.has(transition.to)) {
      context.addIssue({
        code: "custom",
        path: ["transitions", index, "to"],
        message: "Transition target must reference an existing node.",
      });
    }
  });
  const transitionKeys = value.transitions.map((transition) =>
    `${transition.from}\0${transition.outcome}`
  );
  if (new Set(transitionKeys).size !== transitionKeys.length) {
    context.addIssue({
      code: "custom",
      path: ["transitions"],
      message: "A node outcome must have exactly one deterministic transition.",
    });
  }
  value.nodes.forEach((node, index) => {
    if (
      node.failurePolicy === "FOLLOW_FAILURE_EDGE"
      && !value.transitions.some((transition) =>
        transition.from === node.id && transition.outcome === "FAILURE"
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["nodes", index, "failurePolicy"],
        message: "FOLLOW_FAILURE_EDGE requires an explicit FAILURE transition.",
      });
    }
  });
  const endNodeIds = new Set(
    value.nodes.filter((node) => node.type === "END").map((node) => node.id),
  );
  value.transitions.forEach((transition, index) => {
    if (endNodeIds.has(transition.from)) {
      context.addIssue({
        code: "custom",
        path: ["transitions", index, "from"],
        message: "An END node cannot have an outgoing transition.",
      });
    }
  });
  const targetsBySource = new Map<string, string[]>();
  value.transitions.forEach((transition) => {
    targetsBySource.set(
      transition.from,
      [...(targetsBySource.get(transition.from) ?? []), transition.to],
    );
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cycleFound = false;
  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      cycleFound = true;
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    (targetsBySource.get(nodeId) ?? []).forEach(visit);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  visit(value.entrypoint);
  if (cycleFound) {
    context.addIssue({
      code: "custom",
      path: ["transitions"],
      message: "Playbook cycles are not supported; use bounded retry on a node instead.",
    });
  }
  if (![...endNodeIds].some((nodeId) => visited.has(nodeId))) {
    context.addIssue({
      code: "custom",
      path: ["entrypoint"],
      message: "The Playbook entrypoint must reach an END node.",
    });
  }
  const unreachable = nodeIds.filter((nodeId) => !visited.has(nodeId));
  if (unreachable.length) {
    context.addIssue({
      code: "custom",
      path: ["nodes"],
      message: `Every Playbook node must be reachable: ${unreachable.join(", ")}.`,
    });
  }
});

export const expertAgentExecutionSpecSchema = z.discriminatedUnion("mode", [
  expertAgentAgenticExecutionSpecSchema,
  expertAgentWorkflowExecutionSpecSchema,
]);

export const expertAgentVersionSnapshotSchema = z.object({
  schemaVersion: z.literal("agent-version/v1"),
  agentId: z.string().trim().min(1).max(240),
  product: expertAgentProductSpecSchema,
  policy: expertAgentPolicyProfileSchema,
  delegations: expertAgentDelegationsSchema,
  acceptance: expertAgentAcceptanceSpecSchema,
  safety: expertAgentSafetySpecSchema,
  execution: expertAgentExecutionSpecSchema,
  resources: z.array(expertAgentResourceBindingSchema).max(200),
}).strict().superRefine((value, context) => {
  const keys = value.resources.map((resource) =>
    `${resource.kind}:${resource.resourceId}`
  );
  if (new Set(keys).size !== keys.length) {
    context.addIssue({
      code: "custom",
      path: ["resources"],
      message: "A resource can be bound only once per Agent Version.",
    });
  }
});

export const expertAgentDefinitionSchema = z.object({
  product: expertAgentProductSpecSchema,
  policy: expertAgentPolicyProfileSchema,
  delegations: expertAgentDelegationsSchema.default([]),
  acceptance: expertAgentAcceptanceSpecSchema,
  safety: expertAgentSafetySpecSchema,
  execution: expertAgentExecutionSpecSchema,
  resources: z.array(expertAgentResourceBindingSchema).max(200),
}).strict();

export const expertAgentDefinitionInputSchema = expertAgentDefinitionSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
}).strict();

export const expertAgentContractDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(4_000),
  targetUsers: z.array(z.string().trim().min(1).max(240)).min(1).max(20),
  capabilities: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  outOfScope: z.array(z.string().trim().min(1).max(500)).max(100),
  delegationGuidance: z.array(z.string().trim().min(1).max(500)).max(100),
  expectedInputs: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  expectedOutputs: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  executionMode: z.enum(expertAgentExecutionModes),
  policy: expertAgentPolicyProfileSchema,
}).strict();

export const expertAgentTeamSuggestionSchema = z.object({
  kind: z.enum(["KNOWLEDGE", "TOOL", "EXPERT"]),
  id: z.string().trim().min(1).max(240),
  name: z.string().trim().min(1).max(240),
  ready: z.boolean(),
  reason: z.string().trim().min(1).max(1_000),
}).strict();

export const expertAgentTeamSuggestionsSchema = z.object({
  knowledge: z.array(expertAgentTeamSuggestionSchema).max(10),
  tools: z.array(expertAgentTeamSuggestionSchema).max(10),
  experts: z.array(expertAgentTeamSuggestionSchema).max(10),
}).strict();

export const expertAgentContractDraftResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("GENERATED"),
    draft: expertAgentContractDraftSchema,
    suggestions: expertAgentTeamSuggestionsSchema,
    source: z.object({
      kind: z.enum(["MODEL", "ROUTING"]),
      id: z.string().trim().min(1).max(240),
    }).strict(),
  }).strict(),
  z.object({
    status: z.literal("UNAVAILABLE"),
    reasonCode: z.enum([
      "PROJECT_MODEL_REQUIRED",
      "PROJECT_MODEL_AMBIGUOUS",
      "PROJECT_MODEL_UNAVAILABLE",
    ]),
    message: z.string().trim().min(1).max(2_000),
    manualFallbackAllowed: z.literal(true),
    suggestions: expertAgentTeamSuggestionsSchema,
  }).strict(),
]);

export const expertAgentDraftTryInputSchema = z.object({
  contract: expertAgentContractDraftSchema,
  message: z.string().trim().min(1).max(32_000),
}).strict();

export const expertAgentDraftTryResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("COMPLETED"),
    outcome: z.enum(["ANSWER", "ABSTAIN", "ESCALATE", "CLARIFY"]),
    answer: z.string().trim().min(1).max(32_000),
    source: z.enum(["POLICY_SIMULATION", "PROJECT_MODEL"]),
    persisted: z.literal(false),
    evidence: z.array(z.object({
      kind: z.enum(["PROJECT_MODEL", "USER_INPUT"]),
      label: z.string().trim().min(1).max(500),
    }).strict()).max(20),
  }).strict(),
  z.object({
    status: z.literal("UNAVAILABLE"),
    reasonCode: z.enum([
      "PROJECT_MODEL_REQUIRED",
      "PROJECT_MODEL_AMBIGUOUS",
      "PROJECT_MODEL_UNAVAILABLE",
    ]),
    message: z.string().trim().min(1).max(2_000),
    retryable: z.boolean(),
    persisted: z.literal(false),
  }).strict(),
]);

export const expertAgentEvaluationAssertionReceiptSchema = z.object({
  type: z.enum([
    "EXECUTION",
    "STATUS",
    "EXECUTION_PATH",
    "CITATIONS",
    "OUTPUT_SCHEMA",
    "BLOCK_STABILITY",
    "TOOL_INVOCATION",
    "DELEGATION",
    "CLAIMS",
    "SEMANTIC_QUALITY",
    "SOURCE_COVERAGE",
  ]),
  passed: z.boolean(),
  message: z.string().trim().min(1).max(4_000),
}).strict();

export const expertAgentEvaluationCaseReceiptSchema = z.object({
  caseId: identifierSchema,
  title: z.string().trim().min(1).max(240),
  required: z.boolean(),
  passed: z.boolean(),
  traceId: z.string().trim().min(1).max(128),
  assertions: z.array(expertAgentEvaluationAssertionReceiptSchema).max(200),
}).strict();

export const expertAgentEvaluationSuiteReceiptSchema = z.object({
  suiteId: identifierSchema,
  required: z.boolean(),
  passed: z.boolean(),
  requiredPassRate: z.number().min(0).max(1),
  cases: z.array(expertAgentEvaluationCaseReceiptSchema).max(500),
}).strict();

export const expertAgentTestEvidenceSchema = z.object({
  agentDigest: sha256DigestSchema,
  mode: z.enum(expertAgentTestModes),
  status: z.enum(expertAgentTestStatuses),
  summary: z.string().trim().min(1).max(8_000),
  assertions: z.array(z.object({
    id: z.string().trim().min(1).max(240),
    passed: z.boolean(),
    message: z.string().trim().min(1).max(4_000),
  }).strict()).max(2_000),
  artifacts: z.array(z.object({
    kind: z.string().trim().min(1).max(120),
    uri: z.string().trim().min(1).max(4_000),
    digest: sha256DigestSchema.nullable().default(null),
  }).strict()).max(500),
  evaluationSuites: z.array(expertAgentEvaluationSuiteReceiptSchema).max(100).optional(),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
}).strict();

export const expertAgentArtifactKinds = [
  "MANIFEST",
  "PLAYBOOK",
  "PROMPT",
  "SCHEMA",
  "RUNTIME_CONFIG",
  "OCI_IMAGE",
  "RESOURCE_LOCK",
  "TEST_REPORT",
  "SBOM",
  "PROVENANCE",
] as const;

export const expertAgentArtifactRefSchema = z.object({
  kind: z.enum(expertAgentArtifactKinds),
  mediaType: z.string().trim().min(1).max(240),
  digest: sha256DigestSchema,
  uri: z.string().trim().min(1).max(4_000),
  sizeBytes: z.number().int().nonnegative().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const expertAgentVersionManifestSchema = z.object({
  schemaVersion: z.literal("agent-version-manifest/v1"),
  agentId: z.string().min(1),
  versionId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  contentDigest: sha256DigestSchema,
  executionMode: z.enum(expertAgentExecutionModes),
  artifacts: z.array(expertAgentArtifactRefSchema).min(1).max(1_000),
  requirements: z.array(expertAgentResourceBindingSchema).max(200),
  evidence: z.object({
    testRunId: z.string().min(1),
    testedDigest: sha256DigestSchema,
    passedAt: isoDateTimeSchema,
  }).strict(),
  createdAt: isoDateTimeSchema,
}).strict();

export const expertAgentVersionViewSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  sourceRevision: z.number().int().nonnegative(),
  contentDigest: sha256DigestSchema,
  manifestDigest: sha256DigestSchema,
  artifactSetDigest: sha256DigestSchema,
  publicationNotes: z.string().max(8_000).nullable(),
  gardenStatus: z.enum(["PUBLISHED", "WITHDRAWN"]),
  publishedBy: z.string().min(1),
  publishedAt: isoDateTimeSchema,
}).strict();

export const expertAgentRuntimeEnvelopeSchema = z.object({
  versionId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  contentDigest: sha256DigestSchema,
  snapshot: expertAgentVersionSnapshotSchema,
  manifest: expertAgentVersionManifestSchema,
}).strict();

export const expertAgentCustomerServiceOutcomeSchema = z.enum([
  "ANSWERED",
  "NEED_MORE_INFORMATION",
  "UNKNOWN",
  "ESCALATED",
  "REJECTED",
]);

export type ExpertAgentProductSpec = z.infer<
  typeof expertAgentProductSpecSchema
>;
export type ExpertAgentPolicyProfile = z.infer<
  typeof expertAgentPolicyProfileSchema
>;
export type ExpertAgentAcceptanceSpec = z.infer<
  typeof expertAgentAcceptanceSpecSchema
>;
export type ExpertAgentAcceptanceCase = z.infer<
  typeof expertAgentAcceptanceCaseSchema
>;
export type ExpertAgentEvaluationAssertion = z.infer<
  typeof expertAgentEvaluationAssertionSchema
>;
export type ExpertAgentEvaluationSuite = z.infer<
  typeof expertAgentEvaluationSuiteSchema
>;
export type ExpertAgentSafetySpec = z.infer<
  typeof expertAgentSafetySpecSchema
>;
export type ExpertAgentResourceBinding = z.infer<
  typeof expertAgentResourceBindingSchema
>;
export type ExpertAgentDelegation = z.infer<
  typeof expertAgentDelegationSchema
>;
export type ExpertAgentExecutionSpec = z.infer<
  typeof expertAgentExecutionSpecSchema
>;
export type ExpertAgentVersionSnapshot = z.infer<
  typeof expertAgentVersionSnapshotSchema
>;
export type ExpertAgentDefinition = z.infer<
  typeof expertAgentDefinitionSchema
>;
export type ExpertAgentDefinitionInput = z.infer<
  typeof expertAgentDefinitionInputSchema
>;
export type ExpertAgentContractDraft = z.infer<
  typeof expertAgentContractDraftSchema
>;
export type ExpertAgentContractDraftResult = z.infer<
  typeof expertAgentContractDraftResultSchema
>;
export type ExpertAgentTeamSuggestion = z.infer<
  typeof expertAgentTeamSuggestionSchema
>;
export type ExpertAgentTeamSuggestions = z.infer<
  typeof expertAgentTeamSuggestionsSchema
>;
export type ExpertAgentDraftTryInput = z.infer<
  typeof expertAgentDraftTryInputSchema
>;
export type ExpertAgentDraftTryResult = z.infer<
  typeof expertAgentDraftTryResultSchema
>;
export type ExpertAgentTestEvidence = z.infer<
  typeof expertAgentTestEvidenceSchema
>;
export type ExpertAgentEvaluationCaseReceipt = z.infer<
  typeof expertAgentEvaluationCaseReceiptSchema
>;
export type ExpertAgentEvaluationSuiteReceipt = z.infer<
  typeof expertAgentEvaluationSuiteReceiptSchema
>;
export type ExpertAgentVersionView = z.infer<
  typeof expertAgentVersionViewSchema
>;
export type ExpertAgentArtifactRef = z.infer<
  typeof expertAgentArtifactRefSchema
>;
export type ExpertAgentVersionManifest = z.infer<
  typeof expertAgentVersionManifestSchema
>;
export type ExpertAgentRuntimeEnvelope = z.infer<
  typeof expertAgentRuntimeEnvelopeSchema
>;
export type ExpertAgentCustomerServiceOutcome = z.infer<
  typeof expertAgentCustomerServiceOutcomeSchema
>;
