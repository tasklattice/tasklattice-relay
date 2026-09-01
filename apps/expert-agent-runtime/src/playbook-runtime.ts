import {
  expertAgentWorkflowExecutionSpecSchema,
} from "@tali/contracts";
import {
  Ajv2020,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import {
  PlaybookNodeExecutionError,
  PlaybookSchemaValidationError,
  type Playbook,
  type PlaybookNode,
  type PlaybookOperator,
  type PlaybookOperatorResult,
  type PlaybookRunResult,
} from "./playbook-contract.js";
import type { ExpertAgentTraceEvent } from "./runtime-types.js";

export {
  PlaybookNodeExecutionError,
  PlaybookSchemaValidationError,
  type PlaybookOperator,
  type PlaybookOperatorResult,
  type PlaybookRunResult,
} from "./playbook-contract.js";

type SchemaBoundary = "input" | "output";

interface NodeValidators {
  input?: ValidateFunction;
  output?: ValidateFunction;
}

function trace(
  step: string,
  status: ExpertAgentTraceEvent["status"],
  summary: string,
  attributes: ExpertAgentTraceEvent["attributes"] = {},
): ExpertAgentTraceEvent {
  return { step, status, summary, occurredAt: new Date().toISOString(), attributes };
}

function abortError(signal: AbortSignal, fallback: string): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(fallback);
}

function assertSchema(
  validator: ValidateFunction | undefined,
  value: unknown,
  nodeId: string,
  boundary: SchemaBoundary,
): void {
  if (!validator || validator(value)) return;
  throw new PlaybookSchemaValidationError(
    nodeId,
    boundary,
    [...(validator.errors ?? [])],
  );
}

function compileNodeValidators(execution: Playbook): Map<string, NodeValidators> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return new Map(execution.nodes.map((node) => {
    const validators: NodeValidators = {};
    if (node.inputSchema) validators.input = ajv.compile(node.inputSchema);
    if (node.outputSchema) validators.output = ajv.compile(node.outputSchema);
    return [node.id, validators];
  }));
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal, "Playbook wait was cancelled."));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(abortError(signal, "Playbook wait was cancelled."));
    }, { once: true });
  });
}

async function withAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  message: string,
): Promise<T> {
  if (signal.aborted) throw abortError(signal, message);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(abortError(signal, message));
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

export class RelayPlaybookRuntime<State> {
  constructor(
    private readonly operators: Partial<Record<PlaybookNode["type"], PlaybookOperator<State>>>,
  ) {}

  async execute(input: {
    execution: Playbook;
    initialState: State;
    signal?: AbortSignal;
  }): Promise<PlaybookRunResult<State>> {
    const execution = expertAgentWorkflowExecutionSpecSchema.parse(input.execution);
    const runSignal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(execution.timeoutMs)])
      : AbortSignal.timeout(execution.timeoutMs);
    const nodes = new Map(execution.nodes.map((node) => [node.id, node]));
    const validators = compileNodeValidators(execution);
    const events: ExpertAgentTraceEvent[] = [];
    let state = input.initialState;
    let currentNodeId = execution.entrypoint;

    for (let step = 0; step < execution.nodes.length; step += 1) {
      if (runSignal.aborted) throw abortError(runSignal, "Playbook run timed out or was cancelled.");
      const node = nodes.get(currentNodeId);
      if (!node) throw new Error(`Playbook node ${currentNodeId} was not found.`);
      if (node.type === "END") {
        events.push(trace(node.id, "COMPLETED", "Playbook reached its terminal node."));
        return { state, terminalNodeId: node.id, trace: events };
      }
      const operator = this.operators[node.type];
      if (!operator) throw new Error(`No Playbook operator is registered for ${node.type}.`);
      const maxAttempts = node.retry?.maxAttempts ?? 1;
      let result: PlaybookOperatorResult<State> | null = null;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        events.push(trace(node.id, "STARTED", `Executing ${node.type}.`, {
          attempt,
          nodeType: node.type,
          timeoutMs: node.timeoutMs ?? execution.timeoutMs,
        }));
        const nodeSignal = node.timeoutMs
          ? AbortSignal.any([runSignal, AbortSignal.timeout(node.timeoutMs)])
          : runSignal;
        try {
          assertSchema(validators.get(node.id)?.input, state, node.id, "input");
          const snapshot = await withAbort(
            operator({ node, state, attempt, signal: nodeSignal }),
            nodeSignal,
            `Playbook node ${node.id} timed out or was cancelled.`,
          );
          if (!snapshot.outcome.trim()) throw new Error("A Playbook operator must return an outcome.");
          assertSchema(validators.get(node.id)?.output, snapshot.state, node.id, "output");
          result = snapshot;
          state = snapshot.state;
          events.push(trace(
            node.id,
            "COMPLETED",
            `${node.type} produced ${result.outcome}.`,
            {
              attempt,
              nodeType: node.type,
              outcome: result.outcome,
              ...(result.attributes ?? {}),
            },
          ));
          break;
        } catch (error) {
          lastError = error;
          events.push(trace(
            node.id,
            "FAILED",
            error instanceof Error ? error.message : "Node failed.",
            {
              attempt,
              nodeType: node.type,
              errorType: error instanceof Error ? error.name : "UnknownError",
            },
          ));
          if (attempt < maxAttempts) await wait(node.retry?.backoffMs ?? 0, runSignal);
        }
      }

      let outcome: string;
      if (result) {
        outcome = result.outcome;
      } else if (node.failurePolicy === "FOLLOW_FAILURE_EDGE") {
        outcome = "FAILURE";
      } else {
        throw new PlaybookNodeExecutionError(
          `Required Playbook node ${node.id} failed after ${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"}.`,
          node.id,
          maxAttempts,
          events,
          { cause: lastError },
        );
      }
      const matches = execution.transitions.filter((transition) =>
        transition.from === node.id && transition.outcome === outcome
      );
      if (matches.length !== 1) {
        throw new Error(
          `Playbook requires one transition from ${node.id} on ${outcome}; found ${matches.length}.`,
        );
      }
      currentNodeId = matches[0]!.to;
    }
    throw new Error("Playbook exceeded its validated node bound.");
  }
}
