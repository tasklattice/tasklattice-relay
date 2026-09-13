import { randomUUID } from "node:crypto";
import type { AgentGardenEntry } from "@tali/contracts";
import { runLangGraphSupportDemo } from "@tali/expert-agent-runtime/library";
import { demoAgentMessageInputSchema } from "../api-contracts/schemas";
import { exampleStoreAgentDefinitions } from "./example-store-agent-definitions";

export function demoServiceOrigin(): string {
  return (
    process.env.TALI_BOOTSTRAP_INTERNAL_URL?.trim()
    || process.env.TALI_CONTROL_INTERNAL_URL?.trim()
    || `http://127.0.0.1:${process.env.PORT?.trim() || "38080"}`
  ).replace(/\/$/, "");
}

export interface DemoAgentDefinition {
  id: string;
  name: string;
  description: string;
  integrationType: "a2a";
  platformLabel: string;
  category: string;
  catalogKind?: "TALI_DEMO" | "EXAMPLE_BLUEPRINT";
  framework?: string;
  icon?: string;
  language?: string;
  tags: string[];
  skills: AgentGardenEntry["skills"];
  examplePrompts: string[];
  trace: string[];
  response: (prompt: string) => string;
}

export const demoAgentDefinitions: DemoAgentDefinition[] = [
  ...exampleStoreAgentDefinitions,
  {
    id: "a2a-github-daily-triage",
    name: "GitHub Daily Triage",
    description:
      "Summarizes a day of repository activity, prioritizes issues and pull requests, and prepares a focused handoff.",
    integrationType: "a2a",
    platformLabel: "A2A Standard",
    category: "Developer Tools",
    tags: ["GitHub", "Triage", "Demo"],
    skills: [
      {
        id: "daily-repository-triage",
        name: "Daily repository triage",
        description:
          "Groups same-day issues, pull requests, and failed checks into an ordered work queue.",
        tags: ["GitHub", "Triage"],
      },
      {
        id: "prepare-engineering-handoff",
        name: "Prepare engineering handoff",
        description:
          "Produces a concise summary with owners, risks, and recommended next actions.",
        tags: ["Summary", "Handoff"],
      },
    ],
    examplePrompts: [
      "Triage today's GitHub activity and give me the top three actions.",
      "Summarize open pull requests that need attention before stand-up.",
    ],
    trace: ["Agent Card", "Collect activity", "Rank urgency", "Handoff"],
    response: (prompt) => [
      "Daily triage preview",
      "",
      "1. Review the authentication hotfix first — it is marked release-blocking and has one failing security check.",
      "2. Assign the unowned API timeout issue — it has two new customer confirmations today.",
      "3. Merge the documentation pull request after its final approval — all checks are green.",
      "",
      `Task interpreted as: “${prompt.slice(0, 180)}”`,
      "No repository data was read or changed in this deterministic demo.",
    ].join("\n"),
  },
  {
    id: "a2a-pull-request-risk-scanner",
    name: "Pull Request Risk Scanner",
    description:
      "Reviews a proposed change for release risk, missing evidence, and the approvals required before merge.",
    integrationType: "a2a",
    platformLabel: "A2A Standard",
    category: "Developer Tools",
    tags: ["Pull requests", "Risk", "Demo"],
    skills: [
      {
        id: "scan-pull-request-risk",
        name: "Scan pull request risk",
        description:
          "Evaluates change surface, sensitive files, test evidence, and rollback readiness.",
        tags: ["GitHub", "Risk"],
      },
      {
        id: "recommend-merge-gates",
        name: "Recommend merge gates",
        description:
          "Returns the checks and human approvals appropriate for the detected risk.",
        tags: ["Governance", "Approval"],
      },
    ],
    examplePrompts: [
      "Assess PR #142 for merge risk and tell me which approvals are missing.",
      "Review this payment-service change before I request final approval.",
    ],
    trace: ["Agent Card", "Inspect change", "Score risk", "Recommend gates"],
    response: (prompt) => [
      "Pull request risk preview",
      "",
      "Risk: Medium",
      "• Change surface: API authentication and one database migration.",
      "• Missing evidence: rollback rehearsal and an integration test for expired credentials.",
      "• Recommended gate: security-owner approval plus a green migration smoke test.",
      "",
      `Task interpreted as: “${prompt.slice(0, 180)}”`,
      "This preview uses sample evidence and does not inspect a real repository.",
    ].join("\n"),
  },
  {
    id: "a2a-release-notes-composer",
    name: "Release Notes Composer",
    description:
      "Turns merged work into concise release notes for customers, operators, and internal engineering teams.",
    integrationType: "a2a",
    platformLabel: "A2A Standard",
    category: "Productivity",
    tags: ["Release", "Writing", "Demo"],
    skills: [
      {
        id: "compose-release-notes",
        name: "Compose release notes",
        description:
          "Groups changes by audience and rewrites implementation details as clear outcomes.",
        tags: ["Release", "Writing"],
      },
      {
        id: "flag-release-followups",
        name: "Flag release follow-ups",
        description:
          "Identifies migration steps, known limitations, and documentation gaps.",
        tags: ["Operations", "Documentation"],
      },
    ],
    examplePrompts: [
      "Draft customer-facing notes for today's release.",
      "Turn the merged work into release notes and flag operator actions.",
    ],
    trace: ["Agent Card", "Group changes", "Rewrite by audience", "Quality check"],
    response: (prompt) => [
      "Release notes preview",
      "",
      "What’s new",
      "• Faster Agent discovery with clearer readiness and capability details.",
      "• READY callable Instances are discovered by compatible Supervisors in the same Project.",
      "",
      "Operator note",
      "• Review Instance readiness and delegation capabilities before enabling automation.",
      "",
      `Task interpreted as: “${prompt.slice(0, 180)}”`,
      "This is a sample draft; no release system was queried.",
    ].join("\n"),
  },
  {
    id: "langgraph-support-escalation-router",
    name: "Support Escalation Router",
    description:
      "Routes a support case through classification, policy checks, an approval gate, and a response handoff.",
    integrationType: "a2a",
    platformLabel: "LangGraph / A2A",
    framework: "LangGraph",
    category: "Customer Support",
    tags: ["Workflow", "Approval", "Demo"],
    skills: [
      {
        id: "route-support-escalation",
        name: "Route support escalation",
        description:
          "Classifies a case, selects the responsible team, and records why escalation is required.",
        tags: ["Support", "Routing"],
      },
      {
        id: "prepare-approved-response",
        name: "Prepare approved response",
        description:
          "Drafts the next response after policy and human-approval checkpoints.",
        tags: ["Approval", "Response"],
      },
    ],
    examplePrompts: [
      "Route a billing dispute from an enterprise customer with a production outage.",
      "Classify this support case and show where human approval is required.",
    ],
    trace: ["Normalize input", "Classify case", "Policy check", "Approval gate", "Response handoff"],
    response: (prompt) => [
      "LangGraph workflow preview",
      "",
      "Route: Enterprise Support → Billing Operations",
      "Priority: P1 because production impact and account tier are both high.",
      "Approval gate: A billing owner must approve any credit before the response is sent.",
      "Next action: acknowledge the outage now, then attach the approved remediation plan.",
      "",
      `Task interpreted as: “${prompt.slice(0, 180)}”`,
      "The preview executes a real LangGraph StateGraph with deterministic policy data and does not change a ticketing system.",
    ].join("\n"),
  },
];

/** Deterministic, side-effect-free A2A peers enabled for new Hermes MVPs. */
export const hermesMvpA2aAgentIds = [
  "a2a-github-daily-triage",
  "a2a-pull-request-risk-scanner",
  "langgraph-support-escalation-router",
] as const;

export function demoTestImageReference(): string {
  return process.env.TALI_DEMO_TEST_IMAGE?.trim()
    || "ghcr.io/tasklattice/demo-test:dev";
}

export function demoAgentEndpoint(id: string): string {
  return `${demoServiceOrigin()}/api/v1/demo-agents/${encodeURIComponent(id)}`;
}

export function demoAgentCardUrl(id: string): string {
  return `${demoAgentEndpoint(id)}/agent-card`;
}

export function getDemoAgentDefinition(id: string): DemoAgentDefinition {
  const definition = demoAgentDefinitions.find((agent) => agent.id === id);
  if (!definition) throw new Error("Demo Agent was not found.");
  return definition;
}

export function demoAgentCard(id: string) {
  const definition = getDemoAgentDefinition(id);
  const endpoint = demoAgentEndpoint(id);
  return {
    name: definition.name,
    description: definition.description,
    version: "0.1.0-demo",
    supportedInterfaces: [
      {
        url: endpoint,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: definition.skills.map((skill) => ({
      ...skill,
      examples: definition.examplePrompts,
    })),
  };
}

export type DemoAgentLogSink = (line: string) => void;

function stdoutDemoLog(line: string): void {
  console.log(line);
}

export async function runDemoAgentMessage(
  id: string,
  rawInput: unknown,
  logSink: DemoAgentLogSink = stdoutDemoLog,
) {
  const definition = getDemoAgentDefinition(id);
  const input = demoAgentMessageInputSchema.parse(rawInput);
  const prompt = input.params.message.parts
    .map((part) => part.text)
    .join("\n")
    .trim();
  const startedAt = Date.now();
  const runId = typeof input.id === "string" || typeof input.id === "number"
    ? String(input.id)
    : randomUUID();
  const runtimeLogs: string[] = [];
  const emit = (
    level: "info" | "warn" | "error",
    event: string,
    fields: Record<string, boolean | number | string | null> = {},
  ) => {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      component: "agent-garden-demo",
      agentId: definition.id,
      runId,
      messageId: input.params.message.messageId,
      ...fields,
    });
    runtimeLogs.push(line);
    logSink(line);
  };
  emit("info", "agent.demo.run.started", {
    framework: definition.framework ?? "A2A SDK",
    promptLength: prompt.length,
  });

  try {
    const graphRun = definition.id === "langgraph-support-escalation-router"
      ? await runLangGraphSupportDemo(prompt)
      : undefined;
    const occurredAt = new Date().toISOString();
    const traceEvents = graphRun?.traceEvents ?? definition.trace.map((step) => ({
      step,
      status: "COMPLETED" as const,
      summary: `${step} completed with deterministic sample data.`,
      occurredAt,
      attributes: { simulated: true },
    }));
    for (const traceEvent of traceEvents) {
      const attributes: Record<string, boolean | number | string | null> =
        traceEvent.attributes;
      emit(traceEvent.status === "FAILED" ? "error" : "info", "agent.demo.trace", {
        step: traceEvent.step,
        status: traceEvent.status,
        ...(typeof attributes.attempt === "number"
          ? { attempt: attributes.attempt }
          : {}),
        ...(typeof attributes.outcome === "string"
          ? { outcome: attributes.outcome }
          : {}),
      });
    }
    const executionRuntime = graphRun
      ? "LANGGRAPH_STATE_GRAPH"
      : "DETERMINISTIC_SAMPLE";
    emit("info", "agent.demo.run.finished", {
      status: "SUCCEEDED",
      durationMs: Date.now() - startedAt,
      executionRuntime,
      traceEventCount: traceEvents.length,
    });
    return {
      jsonrpc: "2.0",
      id: input.id,
      result: {
        message: {
          messageId: randomUUID(),
          role: "ROLE_AGENT",
          parts: [
            {
              text: graphRun?.text ?? definition.response(prompt),
            },
          ],
          metadata: {
            demo: true,
            simulatedBehavior: !graphRun,
            agentId: definition.id,
            protocol: "A2A 1.0",
            framework: definition.framework ?? "A2A SDK",
            executionRuntime,
            trace: traceEvents
              .filter((event) => event.status === "COMPLETED")
              .map((event) => event.step),
            traceEvents,
            runtimeLogs,
            ...(graphRun ? { data: graphRun.data } : {}),
          },
        },
      },
    };
  } catch (error) {
    emit("error", "agent.demo.run.failed", {
      status: "FAILED",
      durationMs: Date.now() - startedAt,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  }
}
