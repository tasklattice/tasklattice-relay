import { createHash } from "node:crypto";

const MAX_MESSAGE_CHARACTERS = 16_000;
const MAX_TOOL_SUMMARY_CHARACTERS = 2_000;

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    if (typeof part.text === "string") return part.text;
    if (typeof part.content === "string") return part.content;
    return "";
  }).filter(Boolean).join("\n");
}

export function finalAssistantText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || message.role !== "assistant") continue;
    const text = textContent(message.content).trim();
    if (text) return text.slice(0, MAX_MESSAGE_CHARACTERS);
  }
  return "";
}

export function toolSummaries(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object" || message.role !== "tool") return [];
    const text = textContent(message.content).trim();
    if (!text) return [];
    const name = typeof message.name === "string" ? message.name.slice(0, 120) : "tool";
    return [`${name}: ${text.slice(0, MAX_TOOL_SUMMARY_CHARACTERS)}`];
  }).slice(-32);
}

export function stableConversationId({ runId, sessionKey, prompt, assistant }) {
  if (typeof runId === "string" && runId) return runId;
  return createHash("sha256")
    .update(String(sessionKey ?? ""))
    .update("\0")
    .update(prompt)
    .update("\0")
    .update(assistant)
    .digest("hex");
}

export async function memoryRequest(endpoint, token, operation, payload, timeoutMs) {
  if (!endpoint || !token) return null;
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/${operation}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Memory Gateway returned HTTP ${response.status}`);
  return response.json();
}
