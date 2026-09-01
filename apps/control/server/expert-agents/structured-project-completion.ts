interface ChatMessage {
  content: string;
  role: "system" | "user";
}

interface StructuredProjectCompletionInput {
  baseUrl: string;
  fetchImplementation?: typeof fetch;
  maxTokens: number;
  messages: ChatMessage[];
  model: string;
  operation: string;
  schema: Record<string, unknown>;
  schemaName: string;
  secret: string;
  temperature: number;
}

function responseFormatUnsupported(status: number, body: string): boolean {
  const normalized = body.toLocaleLowerCase();
  return status === 400
    && /response[_ -]?format/.test(normalized)
    && /(unavailable|unsupported|not supported|invalid_request)/.test(normalized);
}

function fallbackMessages(input: StructuredProjectCompletionInput): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "The upstream model does not support native structured-output mode.",
        "Return exactly one JSON object with no Markdown fence, commentary, or extra keys.",
        `The JSON must satisfy this schema: ${JSON.stringify(input.schema)}`,
      ].join("\n"),
    },
    ...input.messages,
  ];
}

function parseContent(bodyText: string, operation: string): unknown {
  let body: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    throw new Error(`Project model returned an invalid ${operation} response.`);
  }
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Project model returned an empty ${operation}.`);
  }
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  try {
    return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
  } catch {
    throw new Error(`Project model returned invalid JSON for the ${operation}.`);
  }
}

async function send(
  input: StructuredProjectCompletionInput,
  nativeStructuredOutput: boolean,
): Promise<Response> {
  const fetchImplementation = input.fetchImplementation ?? fetch;
  return fetchImplementation(`${input.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: nativeStructuredOutput ? input.messages : fallbackMessages(input),
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      ...(nativeStructuredOutput ? {
        response_format: {
          type: "json_schema",
          json_schema: {
            name: input.schemaName,
            strict: true,
            schema: input.schema,
          },
        },
      } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
}

export async function structuredProjectCompletion(
  input: StructuredProjectCompletionInput,
): Promise<unknown> {
  let response = await send(input, true);
  let bodyText = await response.text();
  if (!response.ok && responseFormatUnsupported(response.status, bodyText)) {
    response = await send(input, false);
    bodyText = await response.text();
  }
  if (!response.ok) {
    throw new Error(
      `Project model could not run ${input.operation} (${response.status}): ${bodyText.slice(0, 500)}`,
    );
  }
  return parseContent(bodyText, input.operation);
}
