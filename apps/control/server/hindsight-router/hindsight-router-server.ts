import { createServer, type IncomingMessage } from "node:http";
import { HindsightBootstrapRouter } from "./hindsight-bootstrap-router";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body exceeds 10 MiB.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "4010", 10);
const hindsightHealthUrl = requiredEnvironment("TALI_HINDSIGHT_LOCAL_HEALTH_URL");
const router = new HindsightBootstrapRouter({
  controlBaseUrl: requiredEnvironment("TALI_HINDSIGHT_CONTROL_URL"),
  controlToken: requiredEnvironment("TALI_HINDSIGHT_CONTROL_TOKEN"),
  embeddingDimensions: Number.parseInt(
    requiredEnvironment("TALI_HINDSIGHT_EMBEDDING_DIMENSIONS"),
    10,
  ),
  routerToken: requiredEnvironment("TALI_HINDSIGHT_ROUTER_TOKEN"),
});

let stopped = false;
async function observeHindsight(): Promise<void> {
  while (!stopped) {
    try {
      const response = await fetch(hindsightHealthUrl, {
        signal: AbortSignal.timeout(1_500),
      });
      router.setHindsightReady(response.ok);
    } catch {
      router.setHindsightReady(false);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const method = incoming.method ?? "GET";
    const body = method === "GET" || method === "HEAD"
      ? undefined
      : await requestBody(incoming);
    const request = new Request(
      `http://${incoming.headers.host ?? `${host}:${port}`}${incoming.url ?? "/"}`,
      {
        method,
        headers: incoming.headers as HeadersInit,
        ...(body ? { body: body.toString("utf8") } : {}),
      },
    );
    const response = await router.handle(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({
      error: { message: error instanceof Error ? error.message : "Internal router error." },
    }));
  }
});

server.listen(port, host, () => {
  console.log(JSON.stringify({
    severity: "INFO",
    message: "Hindsight Project Router listening.",
    host,
    port,
  }));
});

void observeHindsight();

function shutdown(): void {
  stopped = true;
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
