import { describe, expect, it } from "vitest";
import type { ExpertAgentExecutionSpec } from "@tali/contracts";
import {
  canConnectPlaybook,
  createPlaybookCanvasModel,
  layoutPlaybookNodes,
} from "@/features/expert-agents/playbook-workflow-canvas";

type WorkflowExecution = Extract<ExpertAgentExecutionSpec, { mode: "WORKFLOW" }>;

const execution: WorkflowExecution = {
  mode: "WORKFLOW",
  engine: { framework: "relay-playbook", version: "1.0.0" },
  entrypoint: "reason",
  configuration: {},
  nodes: [
    { id: "reason", type: "REASON", configuration: {} },
    { id: "decision", type: "DECISION", configuration: {} },
    { id: "response", type: "RESPONSE", configuration: {} },
    { id: "end", type: "END", configuration: {} },
  ],
  transitions: [
    { from: "reason", outcome: "NEXT", to: "decision" },
    { from: "decision", outcome: "MATCHED", to: "response" },
    { from: "decision", outcome: "NO_MATCH", to: "end" },
    { from: "response", outcome: "NEXT", to: "end" },
  ],
  timeoutMs: 30_000,
};

describe("Playbook workflow canvas model", () => {
  it("maps domain transitions to labeled outcome handles", () => {
    const model = createPlaybookCanvasModel(execution, "decision");

    expect(model.nodes.find((node) => node.id === "decision")?.selected).toBe(true);
    expect(model.edges.find((edge) => edge.id === "decision:MATCHED")).toMatchObject({
      source: "decision",
      sourceHandle: "MATCHED",
      target: "response",
      label: "MATCHED",
    });
  });

  it("lays a directed Playbook out from left to right", () => {
    const model = createPlaybookCanvasModel(execution, null);
    const nodes = layoutPlaybookNodes(model.nodes, model.edges);
    const reason = nodes.find((node) => node.id === "reason")!;
    const end = nodes.find((node) => node.id === "end")!;

    expect(reason.position.x).toBeLessThan(end.position.x);
    expect(nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
  });

  it("rejects cycles, self-links, terminal sources, and links into the entrypoint", () => {
    expect(canConnectPlaybook(execution, "reason", "reason")).toBe(false);
    expect(canConnectPlaybook(execution, "end", "response")).toBe(false);
    expect(canConnectPlaybook(execution, "response", "reason")).toBe(false);
    expect(canConnectPlaybook(execution, "response", "decision")).toBe(false);
    expect(canConnectPlaybook(execution, "reason", "response")).toBe(true);
  });
});
