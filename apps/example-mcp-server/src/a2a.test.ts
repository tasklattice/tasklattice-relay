import { describe, expect, it } from "vitest";
import {
  createDemoAgentCard,
  getDemoA2aAgent,
  runDemoA2aMessage,
} from "./a2a.js";

describe("demo-test A2A runtime", () => {
  it("publishes a card for the selected Agent and its Pod endpoint", () => {
    expect(createDemoAgentCard(
      "a2a-github-daily-triage",
      "http://tali-a2a-example.project.svc.cluster.local:3000/",
    )).toMatchObject({
      name: "GitHub Daily Triage",
      supportedInterfaces: [{
        url: "http://tali-a2a-example.project.svc.cluster.local:3000",
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      }],
      skills: [
        { id: "daily-repository-triage" },
        { id: "prepare-engineering-handoff" },
      ],
    });
  });

  it("runs the selected Agent as an independent A2A service", async () => {
    const response = await runDemoA2aMessage("a2a-pull-request-risk-scanner", {
      jsonrpc: "2.0",
      id: "request-1",
      method: "SendMessage",
      params: {
        message: {
          messageId: "message-1",
          role: "ROLE_USER",
          parts: [{ text: "Assess PR #142." }],
        },
      },
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "request-1",
      result: {
        message: {
          role: "ROLE_AGENT",
          metadata: {
            agentId: "a2a-pull-request-risk-scanner",
            trace: ["Agent Card", "Inspect change", "Score risk", "Recommend gates"],
          },
        },
      },
    });
    expect(response.result.message.parts[0]?.text).toContain("Risk: Medium");
    expect(response.result.message.metadata.runtimeLogs.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "agent.demo.run.started" }),
        expect.objectContaining({ event: "agent.demo.trace", step: "Score risk" }),
        expect.objectContaining({ event: "agent.demo.run.finished", status: "SUCCEEDED" }),
      ]),
    );
    expect(response.result.message.metadata.runtimeLogs.join("\n")).not.toContain(
      "Assess PR #142.",
    );
  });

  it("runs the Support Router through a real LangGraph StateGraph", async () => {
    const response = await runDemoA2aMessage("langgraph-support-escalation-router", {
      jsonrpc: "2.0",
      id: "request-langgraph-1",
      method: "SendMessage",
      params: {
        message: {
          messageId: "message-langgraph-1",
          role: "ROLE_USER",
          parts: [{ text: "Route an enterprise billing outage." }],
        },
      },
    });

    expect(response.result.message.metadata).toMatchObject({
      framework: "LangGraph",
      executionRuntime: "LANGGRAPH_STATE_GRAPH",
      simulatedBehavior: false,
      data: {
        category: "BILLING",
        priority: "P1",
        approvalRequired: true,
      },
    });
    expect(response.result.message.metadata.traceEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        step: "policy-check",
        attributes: expect.objectContaining({ outcome: "APPROVAL_REQUIRED" }),
      }),
    ]));
    expect(response.result.message.parts[0]?.text).toContain(
      "Enterprise Support → Billing Operations",
    );
  });

  it("rejects an unknown startup Agent", () => {
    expect(() => getDemoA2aAgent("missing-agent")).toThrow(
      "Unknown demo A2A Agent",
    );
  });
});
