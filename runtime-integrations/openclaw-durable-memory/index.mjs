import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  finalAssistantText,
  memoryRequest,
  stableConversationId,
  toolSummaries,
} from "./client.mjs";

const endpoint = process.env.TALI_DURABLE_MEMORY_ENDPOINT ?? "";
const token = process.env.TALI_DURABLE_MEMORY_TOKEN ?? "";
const pending = new Map();

function correlationKey(event, context) {
  return context.runId ?? event.runId ?? context.sessionKey ?? null;
}

function warn(operation, error) {
  const detail = error instanceof Error ? error.message : "delivery failed";
  console.warn(`[tali-durable-memory] ${operation} unavailable: ${detail}`);
}

export default definePluginEntry({
  id: "tali-durable-memory",
  name: "TaskLattice Durable Memory",
  description: "Recalls and asynchronously retains the fixed Relay Memory bound to this Instance.",
  register(api) {
    api.on("before_prompt_build", async (event, context) => {
      const key = correlationKey(event, context);
      if (key) pending.set(key, { prompt: event.prompt, sessionKey: context.sessionKey });
      if (!endpoint || !token || !event.prompt.trim()) return;
      try {
        const response = await memoryRequest(
          endpoint,
          token,
          "recall",
          { query: event.prompt, maxItems: 6 },
          1_800,
        );
        if (typeof response?.context === "string" && response.context.trim()) {
          // Context-only mutation cannot add tools, credentials, or policy.
          return { prependContext: response.context };
        }
      } catch (error) {
        warn("recall", error);
      }
    });

    api.on("agent_end", (event, context) => {
      if (!event.success || !endpoint || !token) return;
      const key = correlationKey(event, context);
      const turn = key ? pending.get(key) : undefined;
      if (key) pending.delete(key);
      const prompt = turn?.prompt ?? "";
      const assistant = finalAssistantText(event.messages);
      if (!prompt.trim() || !assistant.trim()) return;
      const conversationId = stableConversationId({
        runId: event.runId ?? context.runId,
        sessionKey: turn?.sessionKey ?? context.sessionKey,
        prompt,
        assistant,
      });
      // Do not await the Gateway: Relay persists an encrypted Outbox event and
      // the normal Agent response remains off the retain critical path.
      void memoryRequest(
        endpoint,
        token,
        "retain",
        {
          conversationId,
          ...(context.sessionKey ? { sessionId: context.sessionKey } : {}),
          user: prompt,
          assistant,
          occurredAt: new Date().toISOString(),
          toolSummaries: toolSummaries(event.messages),
        },
        2_000,
      ).catch((error) => warn("retain", error));
    });
  },
});
