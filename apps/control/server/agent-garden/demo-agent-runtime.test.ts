import { describe, expect, it, vi } from "vitest";
import {
  demoAgentCard,
  demoAgentDefinitions,
  demoAgentEndpoint,
  hermesMvpA2aAgentIds,
  runDemoAgentMessage,
} from "./demo-agent-runtime";
import { databaseAgentCatalog } from "./database-agent-catalog";

describe("demo Agent runtime", () => {
  it("uses the deployed Control Service origin for callable examples", () => {
    vi.stubEnv(
      "TALI_BOOTSTRAP_INTERNAL_URL",
      "http://tali-relay-control.tali.svc.cluster.local:38080/",
    );
    expect(demoAgentEndpoint("a2a-github-daily-triage")).toBe(
      "http://tali-relay-control.tali.svc.cluster.local:38080/api/v1/demo-agents/a2a-github-daily-triage",
    );
    vi.unstubAllEnvs();
  });

  it("publishes the database-backed example store and runtime demos", () => {
    expect(
      demoAgentDefinitions.filter(
        (agent) => agent.integrationType === "a2a",
      ),
    ).toHaveLength(16);
    expect(
      demoAgentDefinitions.filter(
        (agent) => agent.catalogKind === "EXAMPLE_BLUEPRINT",
      ),
    ).toHaveLength(12);
  });

  it("publishes an Agent Card with callable skills", () => {
    const card = demoAgentCard("a2a-github-daily-triage");
    expect(card).toMatchObject({
      name: "GitHub Daily Triage",
      capabilities: { streaming: false },
    });
    expect(card.supportedInterfaces[0]).toMatchObject({
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
    });
    expect(card.skills.map((skill) => skill.id)).toContain(
      "daily-repository-triage",
    );
  });

  it("selects independently deployable A2A examples for the Hermes MVP", () => {
    expect(hermesMvpA2aAgentIds).toEqual([
      "a2a-github-daily-triage",
      "a2a-pull-request-risk-scanner",
      "langgraph-support-escalation-router",
    ]);
    expect(
      hermesMvpA2aAgentIds.map((id) =>
        demoAgentDefinitions.find((agent) => agent.id === id)?.platformLabel
      ),
    ).toEqual(["A2A Standard", "A2A Standard", "LangGraph / A2A"]);
    expect(
      databaseAgentCatalog.find(
        (agent) => agent.id === "langgraph-support-escalation-router",
      )?.configuration,
    ).toMatchObject({
      onboardingSource: "CONTAINER_IMAGE",
      imageReference: expect.any(String),
      args: JSON.stringify(["a2a", "langgraph-support-escalation-router"]),
      runtimeOwnership: "PROJECT_MANAGED_INSTANCE",
    });
  });

  it("executes the LangGraph demo and returns its structured runtime logs", async () => {
    const response = await runDemoAgentMessage(
      "langgraph-support-escalation-router",
      {
        jsonrpc: "2.0",
        id: "preview-1",
        method: "SendMessage",
        params: {
          message: {
            messageId: "message-1",
            role: "ROLE_USER",
            parts: [
              {
                text: "Route an enterprise billing outage.",
              },
            ],
          },
        },
      },
      () => undefined,
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "preview-1",
      result: {
        message: {
          role: "ROLE_AGENT",
          metadata: {
            demo: true,
            protocol: "A2A 1.0",
            framework: "LangGraph",
            executionRuntime: "LANGGRAPH_STATE_GRAPH",
            simulatedBehavior: false,
            trace: [
              "normalize-input",
              "classify-case",
              "policy-check",
              "approval-gate",
              "response-handoff",
              "end",
            ],
          },
        },
      },
    });
    expect(response.result.message.parts[0]?.text).toContain(
      "LangGraph support routing result",
    );
    expect(response.result.message.parts[0]?.text).toContain("Priority: P1");
    expect(response.result.message.metadata.traceEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        step: "policy-check",
        status: "COMPLETED",
        attributes: expect.objectContaining({
          framework: "langgraph",
          outcome: "APPROVAL_REQUIRED",
        }),
      }),
    ]));
    expect(response.result.message.metadata.runtimeLogs.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "agent.demo.run.started" }),
        expect.objectContaining({ event: "agent.demo.trace", step: "approval-gate" }),
        expect.objectContaining({
          event: "agent.demo.run.finished",
          executionRuntime: "LANGGRAPH_STATE_GRAPH",
        }),
      ]),
    );
    expect(response.result.message.metadata.runtimeLogs.join("\n")).not.toContain(
      "Route an enterprise billing outage.",
    );
  });
});
