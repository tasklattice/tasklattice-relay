import {
  type ExpertAgentAcceptanceCase,
  type ExpertAgentEvaluationAssertion,
  type ExpertAgentEvaluationSuite,
} from "@tali/contracts";
import { Ajv2020 } from "ajv/dist/2020.js";

export interface ExpertAgentEvaluationObservation {
  status: "ANSWER" | "ABSTAIN" | "ESCALATE" | "CLARIFY";
  output: unknown;
  visitedNodeIds: string[];
  citationSourceIds: string[];
  changedBlockIds: string[];
  unchangedBlockIds: string[];
  toolCalls: Array<{ toolName: string }>;
  delegatedExpertAgentIds: string[];
  claims: string[];
  sourceIds: string[];
  semanticScore?: number;
  traceId: string;
  executionError?: string;
}

export interface ExpertAgentEvaluationAssertionResult {
  type: ExpertAgentEvaluationAssertion["type"] | "EXECUTION";
  passed: boolean;
  message: string;
}

export interface ExpertAgentEvaluationCaseResult {
  caseId: string;
  title: string;
  required: boolean;
  passed: boolean;
  traceId: string;
  assertions: ExpertAgentEvaluationAssertionResult[];
}

export interface ExpertAgentEvaluationSuiteResult {
  suiteId: string;
  required: boolean;
  passed: boolean;
  requiredPassRate: number;
  cases: ExpertAgentEvaluationCaseResult[];
}

function includesAll(actual: readonly string[], expected: readonly string[]): boolean {
  const values = new Set(actual);
  return expected.every((value) => values.has(value));
}

function assertionResult(
  assertion: ExpertAgentEvaluationAssertion,
  observation: ExpertAgentEvaluationObservation,
): ExpertAgentEvaluationAssertionResult {
  if (assertion.type === "STATUS") {
    const passed = observation.status === assertion.expected;
    return { type: assertion.type, passed, message: passed ? `Status is ${assertion.expected}.` : `Expected ${assertion.expected}; received ${observation.status}.` };
  }
  if (assertion.type === "EXECUTION_PATH") {
    const missing = assertion.requiredNodeIds.filter((id) => !observation.visitedNodeIds.includes(id));
    const forbidden = assertion.forbiddenNodeIds.filter((id) => observation.visitedNodeIds.includes(id));
    const passed = !missing.length && !forbidden.length;
    return { type: assertion.type, passed, message: passed ? "Execution path matches the structural contract." : `Missing nodes: ${missing.join(", ") || "none"}; forbidden nodes: ${forbidden.join(", ") || "none"}.` };
  }
  if (assertion.type === "CITATIONS") {
    const present = observation.citationSourceIds.length > 0;
    const allowed = !assertion.allowedSourceIds
      || observation.citationSourceIds.every((id) => assertion.allowedSourceIds!.includes(id));
    const passed = present === assertion.required && allowed;
    return { type: assertion.type, passed, message: passed ? "Citation policy passed." : !allowed ? "A citation references a source outside the allowlist." : assertion.required ? "A required citation is missing." : "A forbidden citation was emitted." };
  }
  if (assertion.type === "OUTPUT_SCHEMA") {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(assertion.schema);
    const passed = Boolean(validate(observation.output));
    return { type: assertion.type, passed, message: passed ? "Output matches the required schema." : `Output schema failed: ${(validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`).join("; ")}` };
  }
  if (assertion.type === "BLOCK_STABILITY") {
    const passed = includesAll(observation.changedBlockIds, assertion.changedBlockIds)
      && includesAll(observation.unchangedBlockIds, assertion.unchangedBlockIds)
      && assertion.unchangedBlockIds.every((id) => !observation.changedBlockIds.includes(id));
    return { type: assertion.type, passed, message: passed ? "Changed and stable AnswerBlocks match the patch contract." : "Observed AnswerBlock changes do not match the expected dependency set." };
  }
  if (assertion.type === "TOOL_INVOCATION") {
    const count = observation.toolCalls.filter((call) => call.toolName === assertion.toolName).length;
    const passed = count >= assertion.minimumCalls;
    return { type: assertion.type, passed, message: passed ? `${assertion.toolName} was called ${count} time(s).` : `${assertion.toolName} was called ${count} time(s); expected at least ${assertion.minimumCalls}.` };
  }
  if (assertion.type === "DELEGATION") {
    const delegated = observation.delegatedExpertAgentIds.includes(assertion.expertAgentId);
    const passed = delegated === assertion.required;
    return { type: assertion.type, passed, message: passed ? "Delegation behavior matches the contract." : assertion.required ? "Required Expert delegation did not occur." : "A forbidden Expert delegation occurred." };
  }
  if (assertion.type === "CLAIMS") {
    const normalized = observation.claims.map((claim) => claim.trim().toLocaleLowerCase());
    const missing = assertion.requiredClaims.filter((claim) => !normalized.includes(claim.trim().toLocaleLowerCase()));
    const forbidden = assertion.forbiddenClaims.filter((claim) => normalized.includes(claim.trim().toLocaleLowerCase()));
    const passed = !missing.length && !forbidden.length;
    return { type: assertion.type, passed, message: passed ? "Required and forbidden factual claims passed." : `Missing claims: ${missing.join(", ") || "none"}; forbidden claims: ${forbidden.join(", ") || "none"}.` };
  }
  if (assertion.type === "SEMANTIC_QUALITY") {
    if (observation.semanticScore === undefined) {
      return { type: assertion.type, passed: false, message: "Semantic evaluator is unavailable; Relay did not invent a score." };
    }
    const passed = observation.semanticScore >= assertion.minimumScore;
    return { type: assertion.type, passed, message: passed ? `Semantic score ${observation.semanticScore} passed.` : `Semantic score ${observation.semanticScore} is below ${assertion.minimumScore}.` };
  }
  const missing = assertion.requiredSourceIds.filter((id) => !observation.sourceIds.includes(id));
  return { type: assertion.type, passed: !missing.length, message: missing.length ? `Required sources are missing: ${missing.join(", ")}.` : "Required source coverage passed." };
}

export function evaluateExpertAgentCase(input: {
  testCase: ExpertAgentAcceptanceCase;
  observation: ExpertAgentEvaluationObservation;
}): ExpertAgentEvaluationCaseResult {
  const assertions: ExpertAgentEvaluationAssertionResult[] = input.testCase.assertions?.map((assertion) =>
    assertionResult(assertion, input.observation)
  ) ?? [{
    type: "SEMANTIC_QUALITY" as const,
    passed: false,
    message: "This legacy case has no executable structured assertions.",
  }];
  if (input.observation.executionError) {
    assertions.unshift({
      type: "EXECUTION",
      passed: false,
      message: `Version execution failed: ${input.observation.executionError}`,
    });
  }
  return {
    caseId: input.testCase.id,
    title: input.testCase.title,
    required: input.testCase.required,
    passed: assertions.every((assertion) => assertion.passed),
    traceId: input.observation.traceId,
    assertions,
  };
}

export async function runExpertAgentEvaluationSuite(input: {
  suite: ExpertAgentEvaluationSuite;
  cases: ExpertAgentAcceptanceCase[];
  minimumRequiredPassRate?: number;
  execute: (testCase: ExpertAgentAcceptanceCase) => Promise<ExpertAgentEvaluationObservation>;
}): Promise<ExpertAgentEvaluationSuiteResult> {
  const caseById = new Map(input.cases.map((testCase) => [testCase.id, testCase]));
  const results: ExpertAgentEvaluationCaseResult[] = [];
  for (const caseId of input.suite.caseIds) {
    const testCase = caseById.get(caseId);
    if (!testCase) throw new Error(`Evaluation Suite references missing case ${caseId}.`);
    results.push(evaluateExpertAgentCase({
      testCase,
      observation: await input.execute(testCase),
    }));
  }
  const required = results.filter((result) => result.required);
  const requiredPassRate = required.length
    ? required.filter((result) => result.passed).length / required.length
    : 1;
  return {
    suiteId: input.suite.id,
    required: input.suite.required,
    passed: requiredPassRate >= (input.minimumRequiredPassRate ?? 1),
    requiredPassRate,
    cases: results,
  };
}
