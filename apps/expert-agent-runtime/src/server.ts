import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  expertAgentRuntimeEnvelopeSchema,
  type ExpertAgentRuntimeEnvelope,
} from "@tali/contracts";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
} from "@a2a-js/sdk/server";
import {
  UserBuilder,
  agentCardHandler,
  jsonRpcHandler,
} from "@a2a-js/sdk/server/express";
import express, { type NextFunction, type Request, type Response } from "express";
import { ExpertAgentA2aExecutor, expertAgentCard } from "./a2a-executor.js";
import { DeterministicCustomerSupportEngine } from "./engines/deterministic-customer-support-engine.js";
import { ControlledOffboardingEngine } from "./engines/controlled-offboarding-engine.js";
import { GitHubWeeklyCommitEngine } from "./engines/github-weekly-commit-engine.js";
import { ExpertAgentRuntime } from "./expert-agent-runtime.js";
import { ProjectRuntimeBridgeResourceClient } from "./project-runtime-bridge-client.js";

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

export function loadRuntimeEnvelope(path: string): ExpertAgentRuntimeEnvelope {
  return expertAgentRuntimeEnvelopeSchema.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
}

function bearerMiddleware(expectedToken: string) {
  const expected = Buffer.from(expectedToken, "utf8");
  return (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.header("authorization") ?? "";
    const actual = Buffer.from(
      authorization.startsWith("Bearer ") ? authorization.slice(7) : "",
      "utf8",
    );
    if (
      actual.length !== expected.length
      || !timingSafeEqual(actual, expected)
    ) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

export function createExpertAgentApp(input: {
  runtime: ExpertAgentRuntime;
  publicEndpoint: string;
  bearerToken: string;
}) {
  if (!input.bearerToken) throw new Error("A2A bearer token is required.");
  const card = expertAgentCard(input.runtime, input.publicEndpoint);
  const requestHandler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    new ExpertAgentA2aExecutor(input.runtime),
  );
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({
    limit: "1mb",
    type: ["application/json", "application/a2a+json"],
  }));
  app.get("/healthz", (_request, response) => {
    response.status(200).json({
      status: "ok",
      agentId: input.runtime.envelope.snapshot.agentId,
      versionId: input.runtime.envelope.versionId,
      versionNumber: input.runtime.envelope.versionNumber,
      contentDigest: input.runtime.envelope.contentDigest,
      executionMode: input.runtime.envelope.snapshot.execution.mode,
      engineVersion: input.runtime.envelope.snapshot.execution.engine.version,
    });
  });
  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler, cache: { maxAge: 60 } }),
  );
  app.use(
    "/a2a",
    bearerMiddleware(input.bearerToken),
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );
  return app;
}

export function startExpertAgentServer(): void {
  const host = process.env.HOST?.trim() || "0.0.0.0";
  const port = parsePort(process.env.PORT);
  const envelopePath = process.env.TALI_EXPERT_AGENT_VERSION_FILE?.trim()
    || "/etc/tali/expert-agent/version.json";
  const envelope = loadRuntimeEnvelope(envelopePath);
  const bridgeUrl = process.env.TALI_PROJECT_RUNTIME_BRIDGE_URL?.trim();
  const bridgeToken = process.env.TALI_EXPERT_AGENT_RUNTIME_TOKEN?.trim();
  const a2aBearerToken = process.env.TALI_A2A_BEARER_TOKEN?.trim();
  if (!bridgeUrl || !bridgeToken || !a2aBearerToken) {
    throw new Error(
      "TALI_PROJECT_RUNTIME_BRIDGE_URL, TALI_EXPERT_AGENT_RUNTIME_TOKEN, and TALI_A2A_BEARER_TOKEN are required.",
    );
  }
  const resources = new ProjectRuntimeBridgeResourceClient({
    baseUrl: bridgeUrl,
    token: bridgeToken,
    envelope,
  });
  const runtime = new ExpertAgentRuntime({
    envelope,
    resources,
    telemetry: resources,
    logger: (record) => console.log(JSON.stringify(record)),
    engines: [
      new GitHubWeeklyCommitEngine(),
      new DeterministicCustomerSupportEngine(),
      new ControlledOffboardingEngine(),
    ],
  });
  const publicEndpoint = process.env.TALI_A2A_PUBLIC_URL?.trim()
    || `http://${host}:${port}/a2a`;
  const app = createExpertAgentApp({
    runtime,
    publicEndpoint,
    bearerToken: a2aBearerToken,
  });
  app.listen(port, host, () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      event: "expert_agent.server.listening",
      component: "expert-agent-runtime",
      agentId: envelope.snapshot.agentId,
      versionId: envelope.versionId,
      versionNumber: envelope.versionNumber,
      framework: envelope.snapshot.execution.engine.framework,
      frameworkVersion: envelope.snapshot.execution.engine.version,
      host,
      port,
    }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startExpertAgentServer();
}
