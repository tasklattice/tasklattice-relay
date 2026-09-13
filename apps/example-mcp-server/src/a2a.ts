import { randomUUID } from "node:crypto";
import { runLangGraphSupportDemo } from "@tali/expert-agent-runtime/library";
import express, { type Request, type Response } from "express";
import { z } from "zod";

interface DemoA2aAgent {
  id: string;
  name: string;
  description: string;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
  }>;
  examples: string[];
  trace: string[];
  response(prompt: string): string;
}

const demoA2aAgents: DemoA2aAgent[] = [
  {
    id: "a2a-github-daily-triage",
    name: "GitHub Daily Triage",
    description:
      "Summarizes a day of repository activity, prioritizes issues and pull requests, and prepares a focused handoff.",
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
    examples: [
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
    examples: [
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
    id: "langgraph-support-escalation-router",
    name: "Support Escalation Router",
    description:
      "Routes a support case through classification, policy checks, an approval gate, and a response handoff.",
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
    examples: [
      "Route a billing dispute from an enterprise customer with a production outage.",
      "Classify this support case and show where human approval is required.",
    ],
    trace: ["normalize-input", "classify-case", "policy-check", "approval-gate", "response-handoff", "end"],
    response: () => "The LangGraph support runtime did not produce a response.",
  },
];

const sendMessageSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  method: z.literal("SendMessage"),
  params: z.object({
    message: z.object({
      messageId: z.string().min(1),
      role: z.literal("ROLE_USER"),
      parts: z.array(z.object({
        text: z.string().trim().min(1).max(4_000),
      }).passthrough()).min(1).max(16),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export function getDemoA2aAgent(id: string): DemoA2aAgent {
  const agent = demoA2aAgents.find((candidate) => candidate.id === id);
  if (!agent) {
    throw new Error(`Unknown demo A2A Agent: ${id}`);
  }
  return agent;
}

export function createDemoAgentCard(id: string, baseUrl: string) {
  const agent = getDemoA2aAgent(id);
  return {
    name: agent.name,
    description: agent.description,
    version: "0.1.0-demo",
    supportedInterfaces: [
      {
        url: baseUrl.replace(/\/$/, ""),
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
    skills: agent.skills.map((skill) => ({
      ...skill,
      examples: agent.examples,
    })),
  };
}

export async function runDemoA2aMessage(
  id: string,
  rawInput: unknown,
  logSink: (line: string) => void = () => undefined,
) {
  const agent = getDemoA2aAgent(id);
  const input = sendMessageSchema.parse(rawInput);
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
      component: "demo-test-a2a",
      agentId: agent.id,
      runId,
      messageId: input.params.message.messageId,
      ...fields,
    });
    runtimeLogs.push(line);
    logSink(line);
  };
  emit("info", "agent.demo.run.started", { promptLength: prompt.length });
  try {
    const graphRun = agent.id === "langgraph-support-escalation-router"
      ? await runLangGraphSupportDemo(prompt)
      : undefined;
    const traceEvents = graphRun?.traceEvents ?? agent.trace.map((step) => ({
      step,
      status: "COMPLETED" as const,
      attributes: { simulated: true },
    }));
    for (const traceEvent of traceEvents) {
      const attributes: Record<string, boolean | number | string | null> =
        traceEvent.attributes;
      emit(traceEvent.status === "FAILED" ? "error" : "info", "agent.demo.trace", {
        step: traceEvent.step,
        status: traceEvent.status,
        simulated: !graphRun,
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
          parts: [{ text: graphRun?.text ?? agent.response(prompt) }],
          metadata: {
            demo: true,
            agentId: agent.id,
            protocol: "A2A 1.0",
            framework: graphRun ? "LangGraph" : "A2A SDK",
            executionRuntime,
            simulatedBehavior: !graphRun,
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

export function startA2aServer(agentId: string): void {
  const agent = getDemoA2aAgent(agentId);
  const host = process.env.HOST?.trim() || "0.0.0.0";
  const port = parsePort(process.env.PORT);
  const configuredBaseUrl = process.env.TALI_A2A_BASE_URL?.trim().replace(/\/$/, "");
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb", type: ["application/json", "application/a2a+json"] }));
  app.get("/healthz", (_request, response) => {
    response.status(200).json({ agentId, service: "demo-test-a2a", status: "ok" });
  });
  const serveCard = (request: Request, response: Response) => {
    const baseUrl = configuredBaseUrl || `${request.protocol}://${request.get("host")}`;
    response.status(200).json(createDemoAgentCard(agentId, baseUrl));
  };
  app.get("/.well-known/agent-card.json", serveCard);
  app.get("/agent-card", serveCard);
  app.post(["/", "/a2a"], async (request, response) => {
    const parsed = sendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      console.warn(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "warn",
        event: "agent.demo.request.rejected",
        component: "demo-test-a2a",
        agentId,
        errorType: "INVALID_A2A_REQUEST",
      }));
      response.status(400).json({
        jsonrpc: "2.0",
        id: request.body?.id ?? null,
        error: {
          code: -32602,
          message: "Invalid A2A SendMessage request.",
        },
      });
      return;
    }
    response.status(200).json(await runDemoA2aMessage(
      agentId,
      parsed.data,
      (line) => console.log(line),
    ));
  });

  const httpServer = app.listen(port, host, () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      event: "agent.demo.server.listening",
      component: "demo-test-a2a",
      agentId,
      agentName: agent.name,
      host,
      port,
    }));
  });
  installShutdownHandlers(httpServer);
}

function installShutdownHandlers(httpServer: ReturnType<express.Express["listen"]>): void {
  const shutdown = (signal: string) => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      event: "agent.demo.server.stopping",
      component: "demo-test-a2a",
      signal,
    }));
    httpServer.close((error) => {
      if (error) {
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          event: "agent.demo.server.stop_failed",
          component: "demo-test-a2a",
          errorType: error.name,
        }));
        process.exitCode = 1;
      }
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "3000");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535; received ${value ?? ""}.`);
  }
  return parsed;
}
