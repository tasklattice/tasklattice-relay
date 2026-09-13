import { randomUUID } from "node:crypto";
import {
  Role,
  type AgentCard,
  type Message,
} from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { ExpertAgentRuntime } from "./expert-agent-runtime.js";
import type { ExpertAgentExecutionResult } from "./runtime-types.js";

function messageText(message: Message): string {
  return message.parts
    .filter((part) => part.content?.$case === "text")
    .map((part) => part.content?.$case === "text" ? part.content.value : "")
    .join("\n")
    .trim();
}

export class ExpertAgentA2aExecutor implements AgentExecutor {
  constructor(private readonly runtime: ExpertAgentRuntime) {}

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const text = messageText(requestContext.userMessage);
    const result: ExpertAgentExecutionResult = await this.runtime.execute({
      messageId: requestContext.userMessage.messageId,
      contextId: requestContext.contextId,
      text,
      metadata: requestContext.request.metadata ?? {},
    }).catch((): ExpertAgentExecutionResult => ({
      outcome: "FAILED" as const,
      text: "Agent 当前无法完成请求。未生成未经验证的替代答案，请稍后重试或联系支持人员。",
      data: {},
      citations: [],
      trace: [{
        step: "runtime.execute",
        status: "FAILED" as const,
        summary: "Execution failed before a verified result was produced.",
        occurredAt: new Date().toISOString(),
        attributes: {},
      }],
    }));
    const response: Message = {
      messageId: randomUUID(),
      contextId: requestContext.contextId,
      taskId: requestContext.taskId,
      role: Role.ROLE_AGENT,
      parts: [{
        content: { $case: "text", value: result.text },
        metadata: undefined,
        filename: "",
        mediaType: "text/plain; charset=utf-8",
      }, {
        content: {
          $case: "data",
          value: {
            ...result.data,
            ...(result.answer ? { answer: result.answer } : {}),
          },
        },
        metadata: undefined,
        filename: "result.json",
        mediaType: "application/json",
      }],
      metadata: {
        agentId: this.runtime.envelope.snapshot.agentId,
        versionId: this.runtime.envelope.versionId,
        versionNumber: this.runtime.envelope.versionNumber,
        contentDigest: this.runtime.envelope.contentDigest,
        executionMode: this.runtime.envelope.snapshot.execution.mode,
        engineVersion: this.runtime.envelope.snapshot.execution.engine.version,
        outcome: result.outcome,
        citations: result.citations,
        trace: result.trace,
        ...(result.answer ? { answerKind: result.answer.kind } : {}),
      },
      extensions: [],
      referenceTaskIds: [],
    };
    eventBus.publish(AgentEvent.message(response));
    eventBus.finished();
  }

  async cancelTask(_taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.finished();
  }
}

export function expertAgentCard(
  runtime: ExpertAgentRuntime,
  endpoint: string,
): AgentCard {
  const { snapshot, versionNumber } = runtime.envelope;
  return {
    name: snapshot.product.name,
    description: snapshot.product.purpose,
    supportedInterfaces: [{
      url: endpoint,
      protocolBinding: "JSONRPC",
      tenant: "",
      protocolVersion: "1.0",
    }],
    provider: { organization: "TaskLattice", url: "https://tasklattice.ai" },
    version: `v${versionNumber}`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [],
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: snapshot.product.capabilities.map((capability, index) => ({
      id: `capability-${index + 1}`,
      name: capability,
      description: capability,
      tags: [snapshot.execution.mode.toLowerCase()],
      examples: [],
      inputModes: ["text/plain"],
      outputModes: ["text/plain", "application/json"],
      securityRequirements: [],
    })),
    signatures: [],
  };
}
