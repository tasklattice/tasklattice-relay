import type { ExpertAgentExecutionSpec } from "@tali/contracts";
import type { ErrorObject } from "ajv/dist/2020.js";
import type { ExpertAgentTraceEvent } from "./runtime-types.js";

export type Playbook = Extract<ExpertAgentExecutionSpec, { mode: "WORKFLOW" }>;
export type PlaybookNode = Playbook["nodes"][number];

export interface PlaybookOperatorResult<State> {
  outcome: string;
  state: State;
  attributes?: ExpertAgentTraceEvent["attributes"];
}

export type PlaybookOperator<State> = (input: {
  node: PlaybookNode;
  state: State;
  attempt: number;
  signal: AbortSignal;
}) => Promise<PlaybookOperatorResult<State>>;

export interface PlaybookRunResult<State> {
  state: State;
  terminalNodeId: string;
  trace: ExpertAgentTraceEvent[];
}

export class PlaybookNodeExecutionError extends Error {
  constructor(
    message: string,
    readonly nodeId: string,
    readonly attempts: number,
    readonly trace: ExpertAgentTraceEvent[],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PlaybookNodeExecutionError";
  }
}

export class PlaybookSchemaValidationError extends Error {
  constructor(
    readonly nodeId: string,
    readonly boundary: "input" | "output",
    readonly issues: ErrorObject[],
  ) {
    const details = issues.map((issue) =>
      `${issue.instancePath || "/"} ${issue.message ?? "is invalid"}`
    ).join("; ");
    super(`Playbook node ${nodeId} ${boundary} does not match its schema: ${details}`);
    this.name = "PlaybookSchemaValidationError";
  }
}
