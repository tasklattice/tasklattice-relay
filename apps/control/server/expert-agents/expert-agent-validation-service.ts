import { createHash, randomUUID } from "node:crypto";
import {
  answerDocumentSchema,
  expertAgentTryResultSchema,
  expertAgentVersionManifestSchema,
  expertAgentVersionSnapshotSchema,
  type ExpertAgentVersionSnapshot,
  type ExpertAgentEvaluationSuiteReceipt,
  type ExpertAgentTestEvidence,
} from "@tali/contracts";
import {
  ControlledOffboardingEngine,
  DeterministicCustomerSupportEngine,
  ExpertAgentRuntime,
  GitHubWeeklyCommitEngine,
  runExpertAgentEvaluationSuite,
  type ExpertAgentEvaluationObservation,
  type ExpertAgentExecutionResult,
  type ExpertAgentResourceClient,
} from "@tali/expert-agent-runtime/library";
import { prisma } from "../db/prisma";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { ModelRoutingResolver } from "../model-routings/model-routing-service";
import { LiteLLMClient, type LiteLLMAdminClient } from "../providers/litellm-client";
import { ProjectStore } from "../projects/project-store";
import {
  ExpertAgentResourceRevisionService,
  ExpertAgentRuntimeResourceService,
} from "../runtime-bridge/expert-agent-runtime-resource-service";
import { ExpertAgentDeveloperService } from "./expert-agent-developer-service";
import {
  buildExpertAgentVersionSnapshot,
  expertAgentContentDigest,
} from "./expert-agent-domain";
import {
  ExpertAgentLifecycleService,
} from "./expert-agent-lifecycle-service";

interface Assertion {
  id: string;
  passed: boolean;
  message: string;
}

type PublishCheckKind = "CONTRACT" | "FUNCTIONAL" | "SECURITY" | "A2A";
type TestStore = Pick<ProjectStore, "getKnowledgeSourceDefinition" | "getMcpServerDefinition" | "getModelRouting">;
type TestLiteLLM = Pick<LiteLLMAdminClient, "callMcpTool" | "completeStructuredModel">;

interface GateResult {
  assertions: Assertion[];
  artifacts: ExpertAgentTestEvidence["artifacts"];
  evaluationSuites?: ExpertAgentEvaluationSuiteReceipt[];
}

interface RecordedResources {
  client: ExpertAgentResourceClient;
  toolCalls: Array<{ toolName: string }>;
  sourceIds: string[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function errorMessage(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message : fallback).slice(0, 3_800);
}

function evaluationStatus(
  outcome: ExpertAgentExecutionResult["outcome"],
): ExpertAgentEvaluationObservation["status"] {
  if (outcome === "COMPLETED") return "ANSWER";
  if (outcome === "NEED_MORE_INFORMATION") return "CLARIFY";
  if (outcome === "ESCALATED") return "ESCALATE";
  return "ABSTAIN";
}

function evaluationRequest(value: Record<string, unknown> | undefined): {
  text: string;
  metadata: Record<string, unknown>;
} {
  if (!value || typeof value.text !== "string" || !value.text.trim()) {
    throw new Error("Evaluation case has no non-empty request.text.");
  }
  const { text, metadata: rawMetadata, ...context } = value;
  return {
    text: text.trim(),
    metadata: { ...context, ...record(rawMetadata) },
  };
}

function answerBlockChanges(
  result: ExpertAgentExecutionResult,
  metadata: Record<string, unknown>,
): { changedBlockIds: string[]; unchangedBlockIds: string[] } {
  if (!result.answer) return { changedBlockIds: [], unchangedBlockIds: [] };
  if (result.answer.kind === "ANSWER_DOCUMENT") {
    return {
      changedBlockIds: result.answer.blocks.map((block) => block.id),
      unchangedBlockIds: [],
    };
  }
  const changedBlockIds = result.answer.operations.flatMap((operation) =>
    operation.op === "REPLACE_BLOCK" ? [operation.block.id] : []
  );
  const previous = answerDocumentSchema.safeParse(
    metadata.answerDocument ?? metadata.answer,
  );
  return {
    changedBlockIds: unique(changedBlockIds),
    unchangedBlockIds: previous.success
      ? previous.data.blocks
        .map((block) => block.id)
        .filter((id) => !changedBlockIds.includes(id))
      : [],
  };
}

export class ExpertAgentTestService {
  private readonly db: PrismaClient;
  private readonly lifecycle: ExpertAgentLifecycleService;
  private readonly developer: ExpertAgentDeveloperService;
  private readonly store: TestStore;
  private readonly litellm: TestLiteLLM;
  private readonly revisions: ExpertAgentResourceRevisionService;
  private readonly runtimeResources: ExpertAgentResourceClient | undefined;

  constructor(
    private readonly projectId: string,
    dependencies: {
      db?: PrismaClient;
      lifecycle?: ExpertAgentLifecycleService;
      developer?: ExpertAgentDeveloperService;
      store?: TestStore;
      litellm?: TestLiteLLM;
      revisions?: ExpertAgentResourceRevisionService;
      runtimeResources?: ExpertAgentResourceClient;
    } = {},
  ) {
    this.db = dependencies.db ?? prisma();
    this.lifecycle = dependencies.lifecycle ?? new ExpertAgentLifecycleService(this.db);
    this.developer = dependencies.developer ?? new ExpertAgentDeveloperService(this.db);
    this.store = dependencies.store ?? new ProjectStore(projectId, this.db);
    this.litellm = dependencies.litellm ?? new LiteLLMClient();
    this.revisions = dependencies.revisions
      ?? new ExpertAgentResourceRevisionService(projectId, this.db);
    this.runtimeResources = dependencies.runtimeResources;
  }

  async runPublishTest(input: {
    agentId: string;
    actorId: string;
  }) {
    const detail = await this.developer.detail(this.projectId, input.agentId, input.actorId);
    const { expectedRevision: _expectedRevision, ...definition } = detail.definition;
    const snapshot = buildExpertAgentVersionSnapshot({
      agentId: input.agentId,
      definition,
    });
    const agentDigest = expertAgentContentDigest(snapshot);
    if (agentDigest !== detail.contentDigest) {
      throw new Error("The Agent digest does not match its normalized definition.");
    }
    const startedAt = new Date();
    const assertions: Assertion[] = [];
    const artifacts: ExpertAgentTestEvidence["artifacts"] = [];
    let evaluationSuites: ExpertAgentEvaluationSuiteReceipt[] | undefined;
    for (const kind of ["CONTRACT", "FUNCTIONAL", "SECURITY", "A2A"] as const) {
      let gate: GateResult;
      try {
        gate = await this.assertions(kind, snapshot, {
          agentId: input.agentId,
          testRunKey: `agent:${input.agentId}:r${detail.revision}`,
          agentDigest,
        });
      } catch (error) {
        gate = {
          assertions: [{
            id: `${kind.toLowerCase()}-runner`,
            passed: false,
            message: errorMessage(error, "Publish Test runner failed."),
          }],
          artifacts: [],
        };
      }
      assertions.push(...gate.assertions.map((assertion) => ({
        ...assertion,
        id: `${kind.toLowerCase()}:${assertion.id}`,
      })));
      artifacts.push(...gate.artifacts);
      if (gate.evaluationSuites) evaluationSuites = gate.evaluationSuites;
    }
    const passed = assertions.length > 0 && assertions.every((assertion) => assertion.passed);
    const evidence: ExpertAgentTestEvidence = {
      agentDigest,
      mode: "RELEASE",
      status: passed ? "PASSED" : "FAILED",
      summary: passed
        ? `Agent r${detail.revision} passed all publish checks.`
        : `Publish Test failed: ${assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.message).join(" ")}`.slice(0, 8_000),
      assertions,
      artifacts: [{
        kind: "publish-test",
        uri: `agent://${input.agentId}/revisions/${detail.revision}/publish-test`,
        digest: agentDigest,
      }, ...artifacts],
      ...(evaluationSuites ? { evaluationSuites } : {}),
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
    const receipt = await this.lifecycle.recordTestRun({
      projectId: this.projectId,
      agentId: input.agentId,
      actorId: input.actorId,
      agentRevision: detail.revision,
      evidence,
    });
    return {
      id: receipt.id,
      agentRevision: receipt.agentRevision,
      contentDigest: receipt.contentDigest,
      mode: receipt.mode,
      status: receipt.status,
      attempt: receipt.attempt,
      evidence,
    };
  }

  async runDeveloperTry(input: {
    agentId: string;
    actorId: string;
    message: string;
  }) {
    const detail = await this.developer.detail(this.projectId, input.agentId, input.actorId);
    const { expectedRevision: _expectedRevision, ...definition } = detail.definition;
    const snapshot = buildExpertAgentVersionSnapshot({
      agentId: input.agentId,
      definition,
    });
    const agentDigest = expertAgentContentDigest(snapshot);
    if (agentDigest !== detail.contentDigest) {
      throw new Error("The Agent digest does not match its normalized definition.");
    }

    const messageId = randomUUID();
    const traceId = createHash("sha256").update(messageId).digest("hex").slice(0, 32);
    const testRunKey = `agent:${input.agentId}:r${detail.revision}:try:${messageId}`;
    const startedAt = new Date();
    const baseResources = this.runtimeResources ?? new ExpertAgentRuntimeResourceService({
      namespace: "agent-test",
      projectId: this.projectId,
      agentId: input.agentId,
      versionId: testRunKey,
      contentDigest: agentDigest,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    }, {
      db: this.db,
      store: this.store,
      litellm: this.litellm,
      revisions: this.revisions,
      snapshot,
    });
    const recorded = this.recordResources(baseResources);
    const createdAt = startedAt.toISOString();
    const envelope = {
      versionId: testRunKey,
      versionNumber: 1,
      contentDigest: agentDigest,
      snapshot,
      manifest: expertAgentVersionManifestSchema.parse({
        schemaVersion: "agent-version-manifest/v1",
        agentId: input.agentId,
        versionId: testRunKey,
        versionNumber: 1,
        contentDigest: agentDigest,
        executionMode: snapshot.execution.mode,
        artifacts: [{
          kind: "RUNTIME_CONFIG",
          mediaType: "application/vnd.tasklattice.agent-test+json",
          digest: agentDigest,
          uri: `agent://${input.agentId}/tests/${testRunKey}/runtime-config`,
          sizeBytes: null,
          metadata: { ephemeral: true },
        }],
        requirements: snapshot.resources,
        evidence: {
          testRunId: testRunKey,
          testedDigest: agentDigest,
          passedAt: createdAt,
        },
        createdAt,
      }),
    };

    let result: ExpertAgentExecutionResult;
    let executionError: string | undefined;
    try {
      const runtime = new ExpertAgentRuntime({
        envelope,
        resources: recorded.client,
        engines: [
          new GitHubWeeklyCommitEngine(),
          new DeterministicCustomerSupportEngine(),
          new ControlledOffboardingEngine(),
        ],
      });
      result = await runtime.execute({
        messageId,
        contextId: traceId,
        text: input.message,
        metadata: { source: "agent-development-workspace" },
      });
    } catch (error) {
      executionError = errorMessage(error, "Agent test failed.");
      result = {
        outcome: "FAILED",
        text: executionError,
        data: {},
        citations: [],
        trace: [{
          step: "developer.try",
          status: "FAILED",
          summary: executionError,
          occurredAt: new Date().toISOString(),
          attributes: { revision: detail.revision },
        }],
      };
    }

    const durationMs = Math.max(0, Date.now() - startedAt.getTime());
    await this.storeEvaluationTrace({
      agentId: input.agentId,
      testRunKey,
      agentDigest,
      messageId,
      traceId,
      startedAt,
      outcome: result.outcome,
      trace: result.trace,
      citations: result.citations,
      ...(executionError ? { error: executionError } : {}),
      engineVersion: snapshot.execution.engine.version,
      source: "expert-agent",
      triggerType: "USER",
    });

    return expertAgentTryResultSchema.parse({
      traceId,
      outcome: result.outcome,
      text: result.text,
      data: result.data,
      durationMs,
      toolCallCount: recorded.toolCalls.length,
      knowledgeSourceCount: recorded.sourceIds.length,
      citations: result.citations,
      trace: result.trace,
    });
  }

  private assertions(
    kind: PublishCheckKind,
    snapshot: ExpertAgentVersionSnapshot,
    context: {
      agentId: string;
      testRunKey: string;
      agentDigest: string;
    },
  ): Promise<GateResult> {
    if (kind === "CONTRACT") return Promise.resolve({ assertions: this.contractAssertions(snapshot), artifacts: [] });
    if (kind === "SECURITY") return this.securityAssertions(snapshot).then((assertions) => ({ assertions, artifacts: [] }));
    if (kind === "A2A") return Promise.resolve({ assertions: this.a2aAssertions(snapshot), artifacts: [] });
    return this.functionalGate(snapshot, context);
  }

  private contractAssertions(snapshot: ExpertAgentVersionSnapshot): Assertion[] {
    const requiredCases = snapshot.acceptance.cases.filter((testCase) => testCase.required);
    const requiredGuardrails = snapshot.safety.guardrails.filter((guardrail) => guardrail.required);
    return [
      {
        id: "snapshot-schema",
        passed: expertAgentVersionSnapshotSchema.safeParse(snapshot).success,
        message: `Version matches immutable ${snapshot.schemaVersion} schema.`,
      },
      {
        id: "required-acceptance-cases",
        passed: requiredCases.length > 0 && snapshot.acceptance.minimumRequiredPassRate === 1,
        message: "At least one required acceptance case and a 100% required pass rate are configured.",
      },
      {
        id: "required-safety-guardrails",
        passed: requiredGuardrails.length > 0 && snapshot.safety.prohibitedBehaviors.length > 0,
        message: "Required safety guardrails and prohibited behaviors are explicit.",
      },
      {
        id: "executable-evaluation-suites",
        passed: !snapshot.acceptance.suites
          || snapshot.acceptance.suites
            .filter((suite) => suite.required)
            .every((suite) => suite.caseIds.every((caseId) =>
              snapshot.acceptance.cases.some((testCase) =>
                testCase.id === caseId
                && Boolean(testCase.request)
                && Boolean(testCase.assertions?.length)
              )
            )),
        message: "Every required Evaluation Suite case has a structured request and executable assertions.",
      },
    ];
  }

  private async securityAssertions(snapshot: ExpertAgentVersionSnapshot): Promise<Assertion[]> {
    const revisions = await Promise.all(snapshot.resources.map(async (binding) => {
      try {
        let current: string | null = null;
        if (binding.kind === "MCP_SERVER") {
          const server = await this.store.getMcpServerDefinition(binding.resourceId);
          current = server ? this.revisions.mcp(server) : null;
        } else if (binding.kind === "MODEL_ROUTING") {
          const routing = await this.store.getModelRouting(binding.resourceId);
          current = routing ? this.revisions.modelRouting(routing.configurationHash) : null;
        } else if (binding.kind === "KNOWLEDGE_VECTOR_DATABASE") {
          current = await this.revisions.knowledge(binding.resourceId);
        } else {
          current = binding.revision;
        }
        return { binding, current, error: null };
      } catch (error) {
        return { binding, current: null, error: error instanceof Error ? error.message : "Resource unavailable." };
      }
    }));
    const assertions: Assertion[] = revisions.map(({ binding, current, error }) => ({
      id: `resource-${binding.kind.toLowerCase()}-${binding.resourceId}`.slice(0, 240),
      passed: current !== null && binding.revision === current,
      message: error ?? `${binding.kind}:${binding.resourceId} is available and pinned to its current revision.`,
    }));
    assertions.push({
      id: "no-write-capability",
      passed: snapshot.resources.every((binding) => binding.access !== "READ_WRITE"),
      message: "Release 0 Expert Agents have no READ_WRITE resource binding.",
    });
    assertions.push({
      id: "no-general-fallback",
      passed: snapshot.safety.allowGeneralModelFallback === false,
      message: "General model fallback is disabled.",
    });
    if (snapshot.execution.mode === "WORKFLOW") {
      assertions.push({
        id: "workflow-no-model-binding",
        passed: !snapshot.resources.some((binding) => binding.kind === "MODEL_ROUTING"),
        message: "Deterministic Workflow has no request-time model binding.",
      });
    }
    return assertions;
  }

  private a2aAssertions(snapshot: ExpertAgentVersionSnapshot): Assertion[] {
    const input = snapshot.product.inputContract;
    const output = snapshot.product.outputContract;
    const inputRequired = Array.isArray(input.required)
      ? input.required.filter((value): value is string => typeof value === "string")
      : [];
    const outputRequired = Array.isArray(output.required)
      ? output.required.filter((value): value is string => typeof value === "string")
      : [];
    const engineType = snapshot.execution.configuration.engineType;
    return [
      {
        id: "a2a-input-contract",
        passed: input.type === "object" && inputRequired.includes("text"),
        message: "A2A input requires a text field.",
      },
      {
        id: "a2a-output-contract",
        passed: output.type === "object"
          && ["outcome", "text", "citations"].every((field) => outputRequired.includes(field))
          && (snapshot.policy.outputMode !== "PATCHABLE"
            || outputRequired.includes("answer")),
        message: snapshot.policy.outputMode === "PATCHABLE"
          ? "Patchable A2A output exposes outcome, text, citations, and answer artifacts."
          : "A2A output exposes outcome, text, and citations.",
      },
      {
        id: "runtime-engine-supported",
        passed: engineType === "GITHUB_WEEKLY_COMMIT_SUMMARIZER"
          || engineType === "DETERMINISTIC_CUSTOMER_SUPPORT"
          || engineType === "CONTROLLED_OFFBOARDING_KNOWLEDGE",
        message: "The version-pinned Expert Agent runtime supports this engine.",
      },
    ];
  }

  private async functionalGate(
    snapshot: ExpertAgentVersionSnapshot,
    context: {
      agentId: string;
      testRunKey: string;
      agentDigest: string;
    },
  ): Promise<GateResult> {
    const assertions = await this.functionalAssertions(snapshot);
    const evaluationSuites = await this.executeEvaluationSuites(snapshot, context);
    const artifacts: ExpertAgentTestEvidence["artifacts"] = [];
    for (const suite of evaluationSuites) {
      assertions.push({
        id: `suite-${suite.suiteId}`.slice(0, 240),
        passed: !suite.required || suite.passed,
        message: `${suite.required ? "Required" : "Optional"} Evaluation Suite ${suite.suiteId} ${suite.passed ? "passed" : "failed"} at ${(suite.requiredPassRate * 100).toFixed(1)}% required-case pass rate.`,
      });
      artifacts.push({
        kind: "evaluation-suite",
        uri: `agent://${context.agentId}/tests/${context.testRunKey}/evaluation-suites/${suite.suiteId}`,
        digest: context.agentDigest,
      });
      suite.cases.forEach((testCase) => {
        artifacts.push({
          kind: "evaluation-trace",
          uri: `/${encodeURIComponent(this.projectId)}/traces?traceId=${encodeURIComponent(testCase.traceId)}`,
          digest: context.agentDigest,
        });
      });
    }
    return {
      assertions,
      artifacts,
      ...(evaluationSuites.length ? { evaluationSuites } : {}),
    };
  }

  private async executeEvaluationSuites(
    snapshot: ExpertAgentVersionSnapshot,
    context: {
      agentId: string;
      testRunKey: string;
      agentDigest: string;
    },
  ): Promise<ExpertAgentEvaluationSuiteReceipt[]> {
    const suites = snapshot.acceptance.suites ?? [];
    if (!suites.length) return [];
    const baseResources = this.runtimeResources ?? new ExpertAgentRuntimeResourceService({
      namespace: "agent-test",
      projectId: this.projectId,
      agentId: context.agentId,
      versionId: context.testRunKey,
      contentDigest: context.agentDigest,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    }, {
      db: this.db,
      store: this.store,
      litellm: this.litellm,
      revisions: this.revisions,
      snapshot,
    });
    const createdAt = new Date().toISOString();
    const envelope = {
      versionId: context.testRunKey,
      versionNumber: 1,
      contentDigest: context.agentDigest,
      snapshot,
      manifest: expertAgentVersionManifestSchema.parse({
        schemaVersion: "agent-version-manifest/v1",
        agentId: context.agentId,
        versionId: context.testRunKey,
        versionNumber: 1,
        contentDigest: context.agentDigest,
        executionMode: snapshot.execution.mode,
        artifacts: [{
          kind: "RUNTIME_CONFIG",
          mediaType: "application/vnd.tasklattice.agent-test+json",
          digest: context.agentDigest,
          uri: `agent://${context.agentId}/tests/${context.testRunKey}/runtime-config`,
          sizeBytes: null,
          metadata: { ephemeral: true },
        }],
        requirements: snapshot.resources,
        evidence: {
          testRunId: context.testRunKey,
          testedDigest: context.agentDigest,
          passedAt: createdAt,
        },
        createdAt,
      }),
    };

    const receipts: ExpertAgentEvaluationSuiteReceipt[] = [];
    for (const suite of suites) {
      receipts.push(await runExpertAgentEvaluationSuite({
        suite,
        cases: snapshot.acceptance.cases,
        minimumRequiredPassRate: snapshot.acceptance.minimumRequiredPassRate,
        execute: async (testCase) => {
          const messageId = randomUUID();
          const traceId = createHash("sha256").update(messageId).digest("hex").slice(0, 32);
          const startedAt = new Date();
          let request: ReturnType<typeof evaluationRequest>;
          try {
            request = evaluationRequest(testCase.request);
          } catch (error) {
            const message = errorMessage(error, "Evaluation request is invalid.");
            await this.storeEvaluationTrace({
              ...context,
              suiteId: suite.id,
              caseId: testCase.id,
              messageId,
              traceId,
              startedAt,
              outcome: "FAILED",
              trace: [{
                step: "evaluation.request",
                status: "FAILED",
                summary: message,
                occurredAt: new Date().toISOString(),
                attributes: {},
              }],
              citations: [],
              error: message,
              engineVersion: snapshot.execution.engine.version,
            });
            return this.failedObservation(traceId, message);
          }
          const recorded = this.recordResources(baseResources);
          const runtime = new ExpertAgentRuntime({
            envelope,
            resources: recorded.client,
            engines: [
              new GitHubWeeklyCommitEngine(),
              new DeterministicCustomerSupportEngine(),
              new ControlledOffboardingEngine(),
            ],
          });
          let result: ExpertAgentExecutionResult;
          try {
            result = await runtime.execute({
              messageId,
              contextId: traceId,
              text: request.text,
              metadata: request.metadata,
            });
            if (result.outcome === "FAILED") {
              throw new Error("Version engine returned FAILED.");
            }
          } catch (error) {
            const message = errorMessage(error, "Version execution failed.");
            await this.storeEvaluationTrace({
              ...context,
              suiteId: suite.id,
              caseId: testCase.id,
              messageId,
              traceId,
              startedAt,
              outcome: "FAILED",
              trace: [{
                step: "evaluation.execute",
                status: "FAILED",
                summary: message,
                occurredAt: new Date().toISOString(),
                attributes: {},
              }],
              citations: [],
              error: message,
              engineVersion: snapshot.execution.engine.version,
            });
            return this.failedObservation(traceId, message);
          }
          const semantic = await this.evaluateSemanticQuality({
            snapshot,
            testCase,
            request,
            result,
            resources: recorded.client,
          });
          if (semantic.trace) {
            result = { ...result, trace: [...result.trace, semantic.trace] };
          }
          await this.storeEvaluationTrace({
            ...context,
            suiteId: suite.id,
            caseId: testCase.id,
            messageId,
            traceId,
            startedAt,
            outcome: result.outcome,
            trace: result.trace,
            citations: result.citations,
            engineVersion: snapshot.execution.engine.version,
          });
          return this.observation(
            result,
            request.metadata,
            recorded,
            traceId,
            semantic.score,
          );
        },
      }));
    }
    return receipts;
  }

  private recordResources(base: ExpertAgentResourceClient): RecordedResources {
    const toolCalls: Array<{ toolName: string }> = [];
    const sourceIds: string[] = [];
    return {
      toolCalls,
      sourceIds,
      client: {
        callMcpTool: async (input) => {
          toolCalls.push({ toolName: input.toolName });
          return base.callMcpTool(input);
        },
        searchKnowledge: async (input) => {
          const results = await base.searchKnowledge(input);
          sourceIds.push(...results.map((item) => item.id));
          return results;
        },
        completeModel: (input) => base.completeModel(input),
      },
    };
  }

  private observation(
    result: ExpertAgentExecutionResult,
    metadata: Record<string, unknown>,
    recorded: RecordedResources,
    traceId: string,
    semanticScore?: number,
  ): ExpertAgentEvaluationObservation {
    const data = record(result.data);
    const changes = answerBlockChanges(result, metadata);
    const claims = Array.isArray(data.claims)
      ? data.claims.filter((value): value is string => typeof value === "string")
      : [];
    const delegatedExpertAgentIds = result.trace.flatMap((event) => {
      const value = event.attributes.delegatedExpertAgentId;
      return typeof value === "string" ? [value] : [];
    });
    return {
      status: evaluationStatus(result.outcome),
      output: {
        outcome: result.outcome,
        text: result.text,
        data: result.data,
        citations: result.citations,
        ...(result.answer ? { answer: result.answer } : {}),
      },
      visitedNodeIds: unique(result.trace.map((event) => event.step)),
      citationSourceIds: unique(result.citations.map((citation) => citation.sourceId)),
      ...changes,
      toolCalls: recorded.toolCalls,
      delegatedExpertAgentIds: unique(delegatedExpertAgentIds),
      claims,
      sourceIds: unique([
        ...recorded.sourceIds,
        ...result.citations.map((citation) => citation.sourceId),
      ]),
      ...(semanticScore === undefined ? {} : { semanticScore }),
      traceId,
    };
  }

  private async evaluateSemanticQuality(input: {
    snapshot: ExpertAgentVersionSnapshot;
    testCase: ExpertAgentVersionSnapshot["acceptance"]["cases"][number];
    request: ReturnType<typeof evaluationRequest>;
    result: ExpertAgentExecutionResult;
    resources: ExpertAgentResourceClient;
  }): Promise<{
    score?: number;
    trace?: ExpertAgentExecutionResult["trace"][number];
  }> {
    const rubrics = input.testCase.assertions?.flatMap((assertion) =>
      assertion.type === "SEMANTIC_QUALITY" ? [assertion.rubric] : []
    ) ?? [];
    if (!rubrics.length) return {};
    const occurredAt = new Date().toISOString();
    if (input.snapshot.execution.mode !== "AGENTIC") {
      return { trace: {
        step: "evaluation.semantic_quality",
        status: "FAILED",
        summary: "No independent semantic evaluator is configured for this Workflow Version.",
        occurredAt,
        attributes: { rubricCount: rubrics.length },
      } };
    }
    try {
      const completion = record(await input.resources.completeModel({
        modelRoutingId: input.snapshot.execution.modelRoutingId,
        temperature: 0,
        system: [
          "You are an evaluation judge, not the task Agent.",
          "Score only whether the supplied response satisfies the rubrics and request.",
          "Do not infer missing tool facts. Return strict JSON.",
        ].join(" "),
        user: JSON.stringify({
          request: input.request,
          rubrics,
          response: {
            outcome: input.result.outcome,
            text: input.result.text,
            data: input.result.data,
            citations: input.result.citations,
          },
        }).slice(0, 120_000),
        responseJsonSchema: {
          type: "object",
          required: ["score", "rationale"],
          additionalProperties: false,
          properties: {
            score: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: "string" },
          },
        },
      }));
      const score = completion.score;
      if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
        throw new Error("Semantic evaluator returned an invalid score.");
      }
      return {
        score,
        trace: {
          step: "evaluation.semantic_quality",
          status: "COMPLETED",
          summary: "Configured Project Model Routing produced a bounded semantic score.",
          occurredAt,
          attributes: { rubricCount: rubrics.length, score },
        },
      };
    } catch (error) {
      return { trace: {
        step: "evaluation.semantic_quality",
        status: "FAILED",
        summary: errorMessage(error, "Semantic evaluator is unavailable."),
        occurredAt,
        attributes: { rubricCount: rubrics.length },
      } };
    }
  }

  private failedObservation(
    traceId: string,
    executionError: string,
  ): ExpertAgentEvaluationObservation {
    return {
      status: "ABSTAIN",
      output: {},
      visitedNodeIds: [],
      citationSourceIds: [],
      changedBlockIds: [],
      unchangedBlockIds: [],
      toolCalls: [],
      delegatedExpertAgentIds: [],
      claims: [],
      sourceIds: [],
      traceId,
      executionError,
    };
  }

  private async storeEvaluationTrace(input: {
    agentId: string;
    testRunKey: string;
    agentDigest: string;
    suiteId?: string;
    caseId?: string;
    messageId: string;
    traceId: string;
    startedAt: Date;
    outcome: ExpertAgentExecutionResult["outcome"];
    trace: ExpertAgentExecutionResult["trace"];
    citations: ExpertAgentExecutionResult["citations"];
    engineVersion: string;
    error?: string;
    source?: string;
    triggerType?: string;
  }): Promise<void> {
    const endedAt = new Date();
    const failed = input.outcome === "FAILED" || Boolean(input.error);
    const id = createHash("sha256")
      .update([input.agentId, input.testRunKey, input.messageId].join("\0"))
      .digest("hex");
    await this.db.projectRunRecord.create({
      data: {
        projectId: this.projectId,
        id,
        instanceId: input.agentId,
        agentPlatform: "expert-agent",
        source: input.source ?? "expert-agent-evaluation",
        externalRunId: input.messageId,
        triggerType: input.triggerType ?? "EVALUATION",
        status: failed ? "FAILED" : "SUCCEEDED",
        traceId: input.traceId,
        startedAt: input.startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt.getTime() - input.startedAt.getTime()),
        ...(failed ? {
          terminalReason: input.error ?? "ENGINE_FAILED",
          errorCategory: "EVALUATION_EXECUTION_FAILED",
        } : {}),
        expertAgentId: input.agentId,
        expertAgentVersionId: null,
        expertEngineVersion: input.engineVersion,
        expertTrace: {
          testRunKey: input.testRunKey,
          agentDigest: input.agentDigest,
          ...(input.suiteId ? { evaluationSuiteId: input.suiteId } : {}),
          ...(input.caseId ? { evaluationCaseId: input.caseId } : {}),
          outcome: input.outcome,
          trace: input.trace,
          citations: input.citations,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async functionalAssertions(snapshot: ExpertAgentVersionSnapshot): Promise<Assertion[]> {
    if (snapshot.execution.mode === "AGENTIC"
      && snapshot.execution.configuration.engineType === "GITHUB_WEEKLY_COMMIT_SUMMARIZER") {
      const configuration = snapshot.execution.configuration;
      const serverId = String(configuration.githubMcpServerId ?? "");
      const server = await this.store.getMcpServerDefinition(serverId);
      const tool = server?.tools.find((item) => item.name === "list_commits");
      const listCommitsReadOnly = tool?.annotations?.readOnlyHint === true
        || server?.readOnlyTools?.includes("list_commits") === true;
      const assertions: Assertion[] = [
        {
          id: "github-mcp-healthy",
          passed: server?.status === "HEALTHY",
          message: "The bound GitHub MCP Server is healthy.",
        },
        {
          id: "github-list-commits-read-only",
          passed: listCommitsReadOnly
            && (!server?.allowedTools.length || server.allowedTools.includes("list_commits")),
          message: "list_commits is discovered, allowlisted, and explicitly declared read-only by MCP metadata or Project configuration.",
        },
      ];
      if (
        !snapshot.acceptance.suites?.length
        && server?.status === "HEALTHY"
        && listCommitsReadOnly
      ) {
        try {
          await this.litellm.callMcpTool?.(server.litellmServerId, "list_commits", {
            owner: String(configuration.owner ?? ""),
            repo: String(configuration.repo ?? ""),
            page: 1,
            perPage: 1,
          });
          assertions.push({
            id: "github-repository-probe",
            passed: true,
            message: "A real read-only list_commits probe reached the configured GitHub repository.",
          });
        } catch (error) {
          assertions.push({
            id: "github-repository-probe",
            passed: false,
            message: `GitHub repository probe failed: ${error instanceof Error ? error.message : "unknown error"}`,
          });
        }
      } else if (!snapshot.acceptance.suites?.length) {
        assertions.push({
          id: "github-repository-probe",
          passed: false,
          message: "GitHub repository probe was blocked because the MCP Server or tool is not ready.",
        });
      }
      const modelRoutingId = snapshot.execution.modelRoutingId;
      try {
        await new ModelRoutingResolver(this.store as ProjectStore).resolve(modelRoutingId);
        assertions.push({ id: "summary-model-routing", passed: true, message: "Grounded summary Model Routing resolves." });
      } catch (error) {
        assertions.push({
          id: "summary-model-routing",
          passed: false,
          message: `Summary Model Routing failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
      }
      return assertions;
    }

    if (snapshot.execution.mode === "WORKFLOW"
      && snapshot.execution.configuration.engineType === "CONTROLLED_OFFBOARDING_KNOWLEDGE") {
      const execution = snapshot.execution;
      const knowledgeBinding = snapshot.resources.find((binding) =>
        binding.kind === "KNOWLEDGE_VECTOR_DATABASE"
      );
      const source = knowledgeBinding
        ? await this.store.getKnowledgeSourceDefinition(knowledgeBinding.resourceId)
        : undefined;
      const chunks = knowledgeBinding
        ? await this.db.knowledgeVectorChunk.findMany({
            where: { projectId: this.projectId, databaseId: knowledgeBinding.resourceId },
            select: { attributes: true },
          })
        : [];
      const coveredBlocks = new Set(chunks.flatMap((chunk) => {
        const attributes = chunk.attributes;
        if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return [];
        const record = attributes as Record<string, unknown>;
        return record.approved === true
          && typeof record.revision === "string"
          && typeof record.answerBlockId === "string"
          ? [record.answerBlockId]
          : [];
      }));
      return [
        {
          id: "postgresql-knowledge-provider",
          passed: source?.status === "REGISTERED" && source.provider === "postgresql",
          message: "Controlled Offboarding uses a registered platform PostgreSQL Knowledge resource.",
        },
        {
          id: "workflow-transition-coverage",
          passed: execution.nodes.every((node) => node.type === "END"
            || execution.transitions.some((transition) => transition.from === node.id)),
          message: "Every non-END node has an explicit outcome transition.",
        },
        {
          id: "answer-block-knowledge-coverage",
          passed: ["summary", "benefits", "handover"].every((id) => coveredBlocks.has(id)),
          message: "Approved revisioned Knowledge covers summary, benefits, and handover blocks.",
        },
        {
          id: "partial-update-verify-path",
          passed: execution.nodes.some((node) => node.type === "VERIFY")
            && execution.nodes.some((node) =>
              node.type === "RESPONSE" && node.configuration.responseType === "PATCH"
            ),
          message: "Playbook has explicit semantic patch and verification steps.",
        },
      ];
    }

    if (snapshot.execution.mode === "WORKFLOW"
      && snapshot.execution.configuration.engineType === "DETERMINISTIC_CUSTOMER_SUPPORT") {
      const execution = snapshot.execution;
      const knowledgeBinding = snapshot.resources.find((binding) => binding.kind === "KNOWLEDGE_VECTOR_DATABASE");
      const source = knowledgeBinding
        ? await this.store.getKnowledgeSourceDefinition(knowledgeBinding.resourceId)
        : undefined;
      const classifier = execution.nodes.find((node) =>
        node.type === "CLASSIFY_INTENT" || node.type === "REASON"
      );
      const intents = Array.isArray(classifier?.configuration.intents)
        ? classifier.configuration.intents.flatMap((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return [];
            const id = (value as Record<string, unknown>).id;
            return typeof id === "string" ? [id] : [];
          })
        : [];
      const chunks = knowledgeBinding
        ? await this.db.knowledgeVectorChunk.findMany({
            where: { projectId: this.projectId, databaseId: knowledgeBinding.resourceId },
            select: { attributes: true },
          })
        : [];
      const approvedIntentIds = new Set(chunks.flatMap((chunk) => {
        const attributes = chunk.attributes;
        if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return [];
        const record = attributes as Record<string, unknown>;
        return record.approved === true
          && typeof record.intentId === "string"
          && typeof record.revision === "string"
          && record.revision.length > 0
          ? [record.intentId]
          : [];
      }));
      return [
        {
          id: "postgresql-knowledge-provider",
          passed: source?.status === "REGISTERED" && source.provider === "postgresql",
          message: "Customer Support uses a registered platform PostgreSQL Vector Database.",
        },
        {
          id: "workflow-transition-coverage",
          passed: execution.nodes.every((node) => node.type === "END"
            || execution.transitions.some((transition) => transition.from === node.id)),
          message: "Every non-END node has an explicit outcome transition.",
        },
        {
          id: "approved-intent-coverage",
          passed: intents.length > 0 && intents.every((intentId) => approvedIntentIds.has(intentId)),
          message: intents.length
            ? `Approved revisioned Knowledge covers ${approvedIntentIds.size}/${intents.length} configured intents.`
            : "The Workflow has no configured intents.",
        },
      ];
    }
    return [{ id: "engine-functional-support", passed: false, message: "No functional validator supports this engine." }];
  }
}
