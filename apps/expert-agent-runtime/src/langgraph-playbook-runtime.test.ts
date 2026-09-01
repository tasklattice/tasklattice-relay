import type { ExpertAgentExecutionSpec } from "@tali/contracts";
import { describe, expect, it, vi } from "vitest";
import { LangGraphPlaybookRuntime } from "./langgraph-playbook-runtime.js";
import { PlaybookNodeExecutionError } from "./playbook-contract.js";

type State = { visited: string[]; approved: boolean };
type Playbook = Extract<ExpertAgentExecutionSpec, { mode: "WORKFLOW" }>;

function playbook(nodes: Playbook["nodes"], transitions: Playbook["transitions"]): Playbook {
  return {
    mode: "WORKFLOW",
    engine: { framework: "langgraph", version: "1.4.13" },
    entrypoint: nodes[0]!.id,
    configuration: {},
    nodes,
    transitions,
    timeoutMs: 30_000,
  };
}

describe("LangGraphPlaybookRuntime", () => {
  it("compiles deterministic order and Decision outcomes into StateGraph routing", async () => {
    const runtime = new LangGraphPlaybookRuntime<State>({
      TRANSFORM: async ({ node, state }) => ({
        outcome: "NEXT",
        state: { ...state, visited: [...state.visited, node.id] },
      }),
      DECISION: async ({ node, state }) => ({
        outcome: state.approved ? "APPROVED" : "REJECTED",
        state: { ...state, visited: [...state.visited, node.id] },
      }),
      RESPONSE: async ({ node, state }) => ({
        outcome: "DONE",
        state: { ...state, visited: [...state.visited, node.id] },
      }),
    });
    const result = await runtime.execute({
      execution: playbook([
        { id: "prepare", type: "TRANSFORM", configuration: {} },
        { id: "gate", type: "DECISION", configuration: {} },
        { id: "answer", type: "RESPONSE", configuration: {} },
        { id: "reject", type: "RESPONSE", configuration: {} },
        { id: "done", type: "END", configuration: {} },
      ], [
        { from: "prepare", outcome: "NEXT", to: "gate" },
        { from: "gate", outcome: "APPROVED", to: "answer" },
        { from: "gate", outcome: "REJECTED", to: "reject" },
        { from: "answer", outcome: "DONE", to: "done" },
        { from: "reject", outcome: "DONE", to: "done" },
      ]),
      initialState: { visited: [], approved: true },
    });

    expect(result.state.visited).toEqual(["prepare", "gate", "answer"]);
    expect(result.trace.map((event) => `${event.step}:${event.status}`)).toEqual([
      "prepare:STARTED", "prepare:COMPLETED",
      "gate:STARTED", "gate:COMPLETED",
      "answer:STARTED", "answer:COMPLETED",
      "done:COMPLETED",
    ]);
    expect(result.trace.every((event) => event.attributes.framework === "langgraph")).toBe(true);
  });

  it("delegates bounded retries to LangGraph and reports each attempt", async () => {
    const operator = vi.fn().mockRejectedValue(new Error("Knowledge unavailable"));
    const runtime = new LangGraphPlaybookRuntime<State>({ KNOWLEDGE: operator });

    await expect(runtime.execute({
      execution: playbook([
        {
          id: "retrieve",
          type: "KNOWLEDGE",
          configuration: {},
          retry: { maxAttempts: 2, backoffMs: 0 },
        },
        { id: "done", type: "END", configuration: {} },
      ], [{ from: "retrieve", outcome: "FOUND", to: "done" }]),
      initialState: { visited: [], approved: false },
    })).rejects.toMatchObject({
      name: "PlaybookNodeExecutionError",
      nodeId: "retrieve",
      attempts: 2,
      trace: [
        expect.objectContaining({ status: "STARTED", attributes: expect.objectContaining({ attempt: 1 }) }),
        expect.objectContaining({ status: "FAILED", attributes: expect.objectContaining({ attempt: 1 }) }),
        expect.objectContaining({ status: "STARTED", attributes: expect.objectContaining({ attempt: 2 }) }),
        expect.objectContaining({ status: "FAILED", attributes: expect.objectContaining({ attempt: 2 }) }),
      ],
    } satisfies Partial<PlaybookNodeExecutionError>);
    expect(operator).toHaveBeenCalledTimes(2);
  });

  it("routes exhausted failures only through an explicit FAILURE edge", async () => {
    const runtime = new LangGraphPlaybookRuntime<State>({
      KNOWLEDGE: async () => { throw new Error("No evidence source"); },
      RESPONSE: async ({ node, state }) => ({
        outcome: "DONE",
        state: { ...state, visited: [...state.visited, node.id] },
      }),
    });
    const result = await runtime.execute({
      execution: playbook([
        {
          id: "retrieve",
          type: "KNOWLEDGE",
          configuration: {},
          failurePolicy: "FOLLOW_FAILURE_EDGE",
        },
        { id: "abstain", type: "RESPONSE", configuration: {} },
        { id: "done", type: "END", configuration: {} },
      ], [
        { from: "retrieve", outcome: "FAILURE", to: "abstain" },
        { from: "abstain", outcome: "DONE", to: "done" },
      ]),
      initialState: { visited: [], approved: false },
    });

    expect(result.state.visited).toEqual(["abstain"]);
    expect(result.trace).toContainEqual(expect.objectContaining({
      step: "retrieve",
      status: "FAILED",
    }));
  });

  it("propagates LangGraph node timeouts through the bounded operator signal", async () => {
    const runtime = new LangGraphPlaybookRuntime<State>({
      TOOL: async ({ signal, state }) => {
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
        return { outcome: "DONE", state };
      },
    });

    await expect(runtime.execute({
      execution: playbook([
        { id: "slow-tool", type: "TOOL", configuration: {}, timeoutMs: 100 },
        { id: "done", type: "END", configuration: {} },
      ], [{ from: "slow-tool", outcome: "DONE", to: "done" }]),
      initialState: { visited: [], approved: false },
    })).rejects.toMatchObject({
      name: "PlaybookNodeExecutionError",
      nodeId: "slow-tool",
      attempts: 1,
      trace: expect.arrayContaining([
        expect.objectContaining({ step: "slow-tool", status: "FAILED" }),
      ]),
    });
  });

  it("keeps TaskLattice JSON Schema gates around LangGraph nodes", async () => {
    const operator = vi.fn(async ({ state }: { state: State }) => ({
      outcome: "DONE",
      state: { ...state, approved: "not-a-boolean" } as unknown as State,
    }));
    const runtime = new LangGraphPlaybookRuntime<State>({ TRANSFORM: operator });

    await expect(runtime.execute({
      execution: playbook([
        {
          id: "prepare",
          type: "TRANSFORM",
          configuration: {},
          inputSchema: {
            type: "object",
            required: ["approved"],
            properties: { approved: { type: "boolean" } },
          },
          outputSchema: {
            type: "object",
            required: ["approved"],
            properties: { approved: { type: "boolean" } },
          },
        },
        { id: "done", type: "END", configuration: {} },
      ], [{ from: "prepare", outcome: "DONE", to: "done" }]),
      initialState: { visited: [], approved: true },
    })).rejects.toMatchObject({
      name: "PlaybookNodeExecutionError",
      nodeId: "prepare",
      cause: expect.objectContaining({
        name: "PlaybookSchemaValidationError",
        boundary: "output",
      }),
    });
    expect(operator).toHaveBeenCalledOnce();
  });
});
