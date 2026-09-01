import type { ExpertAgentExecutionSpec } from "@tali/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  PlaybookNodeExecutionError,
  RelayPlaybookRuntime,
} from "./playbook-runtime.js";

type State = { visited: string[]; approved: boolean };
type Playbook = Extract<ExpertAgentExecutionSpec, { mode: "WORKFLOW" }>;

function playbook(nodes: Playbook["nodes"], transitions: Playbook["transitions"]): Playbook {
  return {
    mode: "WORKFLOW",
    engine: { framework: "tasklattice-playbook", version: "1.0.0" },
    entrypoint: nodes[0]!.id,
    configuration: {},
    nodes,
    transitions,
    timeoutMs: 30_000,
  };
}

describe("RelayPlaybookRuntime", () => {
  it("owns deterministic order and follows the exact Decision branch", async () => {
    const runtime = new RelayPlaybookRuntime<State>({
      TRANSFORM: async ({ node, state }) => ({ outcome: "NEXT", state: { ...state, visited: [...state.visited, node.id] } }),
      DECISION: async ({ node, state }) => ({ outcome: state.approved ? "APPROVED" : "REJECTED", state: { ...state, visited: [...state.visited, node.id] } }),
      RESPONSE: async ({ node, state }) => ({ outcome: "DONE", state: { ...state, visited: [...state.visited, node.id] } }),
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
  });

  it("bounds retry and never silently skips a failed required node", async () => {
    const operator = vi.fn().mockRejectedValue(new Error("Knowledge unavailable"));
    const runtime = new RelayPlaybookRuntime<State>({ KNOWLEDGE: operator });
    await expect(runtime.execute({
      execution: playbook([
        { id: "retrieve", type: "KNOWLEDGE", configuration: {}, retry: { maxAttempts: 2, backoffMs: 0 } },
        { id: "done", type: "END", configuration: {} },
      ], [{ from: "retrieve", outcome: "FOUND", to: "done" }]),
      initialState: { visited: [], approved: false },
    })).rejects.toMatchObject({
      name: "PlaybookNodeExecutionError",
      nodeId: "retrieve",
      attempts: 2,
    } satisfies Partial<PlaybookNodeExecutionError>);
    expect(operator).toHaveBeenCalledTimes(2);
  });

  it("follows an explicit failure edge only when configured", async () => {
    const runtime = new RelayPlaybookRuntime<State>({
      KNOWLEDGE: async () => { throw new Error("No evidence source"); },
      RESPONSE: async ({ node, state }) => ({ outcome: "DONE", state: { ...state, visited: [...state.visited, node.id] } }),
    });
    const result = await runtime.execute({
      execution: playbook([
        { id: "retrieve", type: "KNOWLEDGE", configuration: {}, failurePolicy: "FOLLOW_FAILURE_EDGE" },
        { id: "abstain", type: "RESPONSE", configuration: {} },
        { id: "done", type: "END", configuration: {} },
      ], [
        { from: "retrieve", outcome: "FAILURE", to: "abstain" },
        { from: "abstain", outcome: "DONE", to: "done" },
      ]),
      initialState: { visited: [], approved: false },
    });
    expect(result.state.visited).toEqual(["abstain"]);
    expect(result.trace).toContainEqual(expect.objectContaining({ step: "retrieve", status: "FAILED" }));
  });

  it("enforces node input and output schemas at the operator boundary", async () => {
    const operator = vi.fn(async ({ state }: { state: State }) => ({
      outcome: "DONE",
      state: { ...state, approved: "not-a-boolean" } as unknown as State,
    }));
    const runtime = new RelayPlaybookRuntime<State>({ TRANSFORM: operator });
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
