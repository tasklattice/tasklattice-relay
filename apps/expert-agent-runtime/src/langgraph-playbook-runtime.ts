import {
  expertAgentWorkflowExecutionSpecSchema,
} from "@tali/contracts";
import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  type LangGraphRunnableConfig,
  type StateGraphAddNodeOptions,
} from "@langchain/langgraph";
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

export const LANGGRAPH_FRAMEWORK = "langgraph";
export const LANGGRAPH_VERSION = "1.4.13";

type SchemaBoundary = "input" | "output";

interface NodeValidators {
  input?: ValidateFunction;
  output?: ValidateFunction;
}

interface LangGraphPlaybookState<State> {
  workflow: State;
  route: string;
  terminalNodeId: string | null;
}

function trace(
  step: string,
  status: ExpertAgentTraceEvent["status"],
  summary: string,
  attributes: ExpertAgentTraceEvent["attributes"] = {},
): ExpertAgentTraceEvent {
  return {
    step,
    status,
    summary,
    occurredAt: new Date().toISOString(),
    attributes: {
      framework: LANGGRAPH_FRAMEWORK,
      frameworkVersion: LANGGRAPH_VERSION,
      ...attributes,
    },
  };
}

function abortError(signal: AbortSignal, fallback: string): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(fallback);
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

function playbookNodeOptions<State, Update extends Record<string, unknown>>(input: {
  execution: Playbook;
  node: PlaybookNode;
}): StateGraphAddNodeOptions<string, undefined, LangGraphPlaybookState<State>, Update> {
  const { execution, node } = input;
  const maxAttempts = node.retry?.maxAttempts ?? 1;
  const failureTransitions = execution.transitions.filter((transition) =>
    transition.from === node.id && transition.outcome === "FAILURE"
  );
  if (node.failurePolicy === "FOLLOW_FAILURE_EDGE" && failureTransitions.length !== 1) {
    throw new Error(
      `Playbook requires one transition from ${node.id} on FAILURE; found ${failureTransitions.length}.`,
    );
  }
  const failureTarget = failureTransitions[0]?.to;
  return {
    metadata: {
      framework: LANGGRAPH_FRAMEWORK,
      frameworkVersion: LANGGRAPH_VERSION,
      playbookNodeId: node.id,
      playbookNodeType: node.type,
    },
    ...(node.timeoutMs ? { timeout: node.timeoutMs } : {}),
    ...(maxAttempts > 1
      ? {
          retryPolicy: {
            maxAttempts,
            initialInterval: node.retry?.backoffMs ?? 0,
            backoffFactor: 1,
            maxInterval: node.retry?.backoffMs ?? 0,
            jitter: false,
            logWarning: false,
            retryOn: () => true,
          },
        }
      : {}),
    ...(node.failurePolicy === "FOLLOW_FAILURE_EDGE" && failureTarget
      ? {
          ends: [failureTarget],
          errorHandler: (state) => new Command<unknown, Update, string>({
            update: {
              workflow: state.workflow,
              route: "FAILURE",
              terminalNodeId: state.terminalNodeId,
            } as unknown as Update,
            goto: failureTarget,
          }),
        }
      : {}),
  };
}

/**
 * Compiles the TaskLattice Workflow contract into a LangGraph StateGraph.
 *
 * TaskLattice keeps governance concerns (schemas, evidence policy, Trace and
 * resource admission); LangGraph owns graph scheduling, conditional routing,
 * bounded node retries, node timeouts and cancellation.
 */
export class LangGraphPlaybookRuntime<State> {
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
    const validators = compileNodeValidators(execution);
    const events: ExpertAgentTraceEvent[] = [];
    const GraphState = Annotation.Root({
      workflow: Annotation<State>(),
      route: Annotation<string>(),
      terminalNodeId: Annotation<string | null>(),
    });
    type GraphStateValue = typeof GraphState.State;
    type GraphStateUpdate = typeof GraphState.Update;
    type GraphNode = (
      state: GraphStateValue,
      config: LangGraphRunnableConfig,
    ) => Promise<GraphStateUpdate>;

    const nodeEntries: Array<[
      string,
      GraphNode,
      StateGraphAddNodeOptions<string, undefined, GraphStateValue, GraphStateUpdate>,
    ]> = execution.nodes.map((node) => {
      if (node.type === "END") {
        const terminal: GraphNode = async (state) => {
          events.push(trace(node.id, "COMPLETED", "Playbook reached its terminal node."));
          return {
            workflow: state.workflow,
            route: state.route,
            terminalNodeId: node.id,
          };
        };
        return [node.id, terminal, {
          metadata: {
            framework: LANGGRAPH_FRAMEWORK,
            frameworkVersion: LANGGRAPH_VERSION,
            playbookNodeId: node.id,
            playbookNodeType: node.type,
          },
        }];
      }

      const operator = this.operators[node.type];
      if (!operator) throw new Error(`No Playbook operator is registered for ${node.type}.`);
      const action: GraphNode = async (state, config) => {
        const attempt = config.executionInfo?.nodeAttempt ?? 1;
        const nodeSignal = config.signal ?? runSignal;
        events.push(trace(node.id, "STARTED", `Executing ${node.type}.`, {
          attempt,
          nodeType: node.type,
          timeoutMs: node.timeoutMs ?? execution.timeoutMs,
        }));
        try {
          assertSchema(validators.get(node.id)?.input, state.workflow, node.id, "input");
          const snapshot: PlaybookOperatorResult<State> = await withAbort(
            operator({
              node,
              state: state.workflow,
              attempt,
              signal: nodeSignal,
            }),
            nodeSignal,
            `LangGraph Playbook node ${node.id} timed out or was cancelled.`,
          );
          if (!snapshot.outcome.trim()) {
            throw new Error("A Playbook operator must return an outcome.");
          }
          assertSchema(validators.get(node.id)?.output, snapshot.state, node.id, "output");
          events.push(trace(
            node.id,
            "COMPLETED",
            `${node.type} produced ${snapshot.outcome}.`,
            {
              attempt,
              nodeType: node.type,
              outcome: snapshot.outcome,
              ...(snapshot.attributes ?? {}),
            },
          ));
          return {
            workflow: snapshot.state,
            route: snapshot.outcome,
            terminalNodeId: state.terminalNodeId,
          };
        } catch (error) {
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
          throw error;
        }
      };
      return [node.id, action, playbookNodeOptions<State, GraphStateUpdate>({ execution, node })];
    });

    const graph = new StateGraph(GraphState).addNode(nodeEntries);
    graph.addEdge(START, execution.entrypoint);
    for (const node of execution.nodes) {
      if (node.type === "END") {
        graph.addEdge(node.id, END);
        continue;
      }
      const transitions = execution.transitions.filter((transition) => transition.from === node.id);
      const destinations = Object.fromEntries(
        transitions.map((transition) => [transition.outcome, transition.to]),
      );
      graph.addConditionalEdges(
        node.id,
        (state) => {
          const matches = transitions.filter((transition) => transition.outcome === state.route);
          if (matches.length !== 1) {
            throw new Error(
              `Playbook requires one transition from ${node.id} on ${state.route}; found ${matches.length}.`,
            );
          }
          return state.route;
        },
        destinations,
      );
    }

    try {
      const compiled = graph.compile({
        name: "tasklattice-langgraph-playbook",
        description: "TaskLattice governed Workflow compiled to LangGraph.",
      });
      const result = await compiled.invoke({
        workflow: input.initialState,
        route: "",
        terminalNodeId: null,
      }, {
        signal: runSignal,
        recursionLimit: execution.nodes.length + 2,
      });
      if (!result.terminalNodeId) {
        throw new Error("LangGraph Playbook did not reach an END node.");
      }
      return {
        state: result.workflow,
        terminalNodeId: result.terminalNodeId,
        trace: events,
      };
    } catch (error) {
      if (runSignal.aborted) {
        throw abortError(runSignal, "LangGraph Playbook run timed out or was cancelled.");
      }
      const lastFailure = [...events].reverse().find((event) => event.status === "FAILED");
      if (!lastFailure) throw error;
      const attempts = events.filter((event) =>
        event.step === lastFailure.step && event.status === "FAILED"
      ).length;
      throw new PlaybookNodeExecutionError(
        `Required Playbook node ${lastFailure.step} failed after ${attempts} attempt${attempts === 1 ? "" : "s"}.`,
        lastFailure.step,
        attempts,
        events,
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }
}
