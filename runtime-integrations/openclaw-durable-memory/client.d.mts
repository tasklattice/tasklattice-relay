export function finalAssistantText(messages: unknown): string;
export function toolSummaries(messages: unknown): string[];
export function stableConversationId(input: {
  runId?: string;
  sessionKey?: string;
  prompt: string;
  assistant: string;
}): string;
export function memoryRequest(
  endpoint: string,
  token: string,
  operation: "recall" | "retain",
  payload: unknown,
  timeoutMs: number,
): Promise<any>;
