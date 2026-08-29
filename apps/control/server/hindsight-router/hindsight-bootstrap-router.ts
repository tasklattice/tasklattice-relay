import { createHash, timingSafeEqual } from "node:crypto";

export type HindsightInferenceKind = "chat" | "embeddings" | "rerank";

export interface HindsightBootstrapRouterOptions {
  controlBaseUrl: string;
  controlToken: string;
  embeddingDimensions: number;
  routerToken: string;
  fetch?: typeof fetch;
}

interface OpenAIRequestBody {
  input?: unknown;
  model?: unknown;
  user?: unknown;
  [key: string]: unknown;
}

const BANK_ID_PATTERN = /^tali_[a-f0-9]{40}$/;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function authorized(header: string | null, token: string): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function inferenceKind(pathname: string): HindsightInferenceKind | undefined {
  if (pathname.endsWith("/chat/completions")) return "chat";
  if (pathname.endsWith("/embeddings")) return "embeddings";
  if (pathname.endsWith("/rerank")) return "rerank";
  return undefined;
}

function requestBankId(request: Request, body: OpenAIRequestBody): string | undefined {
  const candidate = typeof body.user === "string"
    ? body.user
    : request.headers.get("x-hindsight-bank-id")
      ?? request.headers.get("x-bank-id")
      ?? undefined;
  return candidate && BANK_ID_PATTERN.test(candidate) ? candidate : undefined;
}

function inputItems(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [input ?? "bootstrap"];
}

function deterministicBootstrapVector(value: unknown, dimensions: number): number[] {
  const digest = createHash("sha256").update(JSON.stringify(value)).digest();
  const vector = Array.from({ length: dimensions }, (_, index) => {
    const byte = digest[index % digest.length] ?? 0;
    return (byte - 127.5) / 127.5;
  });
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  return vector.map((item) => item / magnitude);
}

function bootstrapResponse(
  kind: HindsightInferenceKind,
  body: OpenAIRequestBody,
  dimensions: number,
): Response {
  const model = typeof body.model === "string" ? body.model : "tali-hindsight-bootstrap";
  if (kind === "embeddings") {
    return jsonResponse({
      object: "list",
      data: inputItems(body.input).map((input, index) => ({
        object: "embedding",
        index,
        embedding: deterministicBootstrapVector(input, dimensions),
      })),
      model,
      usage: { prompt_tokens: 0, total_tokens: 0 },
    });
  }
  if (kind === "chat") {
    return jsonResponse({
      id: "chatcmpl-tali-hindsight-bootstrap",
      object: "chat.completion",
      created: 0,
      model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: "TaskLattice bootstrap probe ready." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
  return jsonResponse({
    id: "rerank-tali-hindsight-bootstrap",
    model,
    results: [],
    usage: { total_tokens: 0 },
  });
}

export class HindsightBootstrapRouter {
  private bootstrapOpen = true;
  private readonly requestFetch: typeof fetch;

  constructor(private readonly options: HindsightBootstrapRouterOptions) {
    if (!Number.isInteger(options.embeddingDimensions) || options.embeddingDimensions <= 0) {
      throw new Error("TALI_HINDSIGHT_EMBEDDING_DIMENSIONS must be a positive integer.");
    }
    this.requestFetch = options.fetch ?? fetch;
  }

  setHindsightReady(ready: boolean): void {
    this.bootstrapOpen = !ready;
  }

  health(): Response {
    return jsonResponse({
      status: "ok",
      component: "hindsight-project-router",
      businessCapability: this.bootstrapOpen ? "BOOTSTRAP_ONLY" : "PROJECT_ROUTED",
    });
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/health/live")) {
      return this.health();
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: { message: "Not found.", type: "invalid_request_error" } }, 404);
    }
    if (!authorized(request.headers.get("authorization"), this.options.routerToken)) {
      return jsonResponse({ error: { message: "Unauthorized.", type: "authentication_error" } }, 401);
    }
    const kind = inferenceKind(url.pathname);
    if (!kind) {
      return jsonResponse({ error: { message: "Unsupported inference endpoint.", type: "invalid_request_error" } }, 404);
    }
    let body: OpenAIRequestBody;
    try {
      body = await request.json() as OpenAIRequestBody;
    } catch {
      return jsonResponse({ error: { message: "A JSON request body is required.", type: "invalid_request_error" } }, 400);
    }
    const bankId = requestBankId(request, body);
    if (bankId) return this.forward(kind, bankId, body);
    if (
      typeof body.user === "string"
      || request.headers.has("x-hindsight-bank-id")
      || request.headers.has("x-bank-id")
    ) {
      return jsonResponse({
        error: { message: "The Hindsight Bank identifier is invalid.", type: "invalid_request_error" },
      }, 400);
    }
    if (!this.bootstrapOpen) {
      return jsonResponse({
        error: {
          message: "Project context is required after Hindsight bootstrap.",
          type: "project_context_required",
        },
      }, 409);
    }
    return bootstrapResponse(kind, body, this.options.embeddingDimensions);
  }

  private async forward(
    kind: HindsightInferenceKind,
    bankId: string,
    body: OpenAIRequestBody,
  ): Promise<Response> {
    const response = await this.requestFetch(
      `${this.options.controlBaseUrl.replace(/\/+$/, "")}/api/internal/hindsight/inference/${kind}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.controlToken}`,
          "content-type": "application/json",
          "x-hindsight-bank-id": bankId,
        },
        body: JSON.stringify({ ...body, user: bankId }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    const headers = new Headers();
    headers.set("content-type", response.headers.get("content-type") ?? "application/json; charset=utf-8");
    return new Response(await response.arrayBuffer(), { status: response.status, headers });
  }
}
