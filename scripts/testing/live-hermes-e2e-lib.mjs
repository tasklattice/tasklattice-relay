import WebSocket from "ws";

export function cookieHeader(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  return values
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

export function websocketUrl(url, path, parameters = {}) {
  const target = new URL(path, url);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== "") {
      target.searchParams.set(key, String(value));
    }
  }
  return target;
}

export function stripAnsi(value) {
  return String(value)
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}

export function eventToolNames(events) {
  return events
    .filter((event) => event?.type === "tool.start")
    .map((event) => event?.payload?.name)
    .filter((name) => typeof name === "string");
}

export function completedToolEvents(events) {
  return events.filter((event) => event?.type === "tool.complete");
}

export function hermesSessionToken(html) {
  const match = String(html).match(
    /window\.__HERMES_SESSION_TOKEN__\s*=\s*["']([^"']+)["']/,
  );
  return match?.[1] ?? "";
}

export function hermesTuiReady(output) {
  return /Available\s*Skills\s*\([1-9]\d*\)/i.test(stripAnsi(output));
}

export function terminalPrompt(prompt) {
  return String(prompt).replace(/\s*\r?\n\s*/g, " ").trim();
}

export function terminalResize(cols, rows) {
  return `\u0000TALI_RESIZE:${cols}:${rows}`;
}

export function inferenceTuiReady(output, agentPlatform) {
  if (agentPlatform === "openclaw") {
    return /gateway connected\s*\|\s*idle/i.test(stripAnsi(output));
  }
  if (agentPlatform === "hermes") return hermesTuiReady(output);
  return stripAnsi(output).trim().length > 0;
}

export async function eventually(operation, {
  description,
  intervalMs = 1_000,
  timeoutMs = 180_000,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description ?? "condition"}.${suffix}`);
}

export class RelayClient {
  constructor(baseUrl, fetchImplementation = globalThis.fetch) {
    this.baseUrl = new URL(baseUrl);
    this.fetch = fetchImplementation;
    this.sessionCookie = "";
  }

  async login(username, password) {
    const response = await this.fetch(
      new URL("/api/auth/sign-in/username", this.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: this.baseUrl.origin,
        },
        body: JSON.stringify({ username, password, rememberMe: false }),
        redirect: "manual",
      },
    );
    if (!response.ok) await this.#throwResponse(response, "login");
    this.sessionCookie = cookieHeader(response.headers);
    if (!this.sessionCookie) throw new Error("Login did not return a session cookie.");
  }

  async request(path, init = {}) {
    const response = await this.rawRequest(path, init);
    if (!response.ok) await this.#throwResponse(response, path);
    if (response.status === 204) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    return contentType.includes("json") ? response.json() : response.text();
  }

  rawRequest(path, init = {}) {
    const headers = new Headers(init.headers);
    if (this.sessionCookie) headers.set("cookie", this.sessionCookie);
    const bodyIsForm = typeof FormData !== "undefined" && init.body instanceof FormData;
    if (init.body !== undefined && !bodyIsForm && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return this.fetch(new URL(path, this.baseUrl), {
      ...init,
      headers,
    });
  }

  project(projectId, path, init) {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}${path}`,
      init,
    );
  }

  async #throwResponse(response, operation) {
    const text = await response.text();
    let detail = text;
    try {
      const body = text ? JSON.parse(text) : {};
      detail = body.error ?? body.detail ?? body.message ?? text;
    } catch {
      // Preserve a non-JSON diagnostic without treating it as a passing result.
    }
    throw new Error(`${operation} failed with HTTP ${response.status}: ${detail}`);
  }
}

export async function exchangeDashboardSession(interactionUrl, fetchImplementation = globalThis.fetch) {
  const accessUrl = new URL(interactionUrl);
  const response = await fetchImplementation(accessUrl, { redirect: "manual" });
  if (response.status !== 303) {
    throw new Error(`Hermes Dashboard access exchange returned HTTP ${response.status}.`);
  }
  const cookie = cookieHeader(response.headers);
  if (!cookie.includes("tali_hermes_session=")) {
    throw new Error("Hermes Dashboard access exchange did not set its session cookie.");
  }
  const cleanUrl = new URL(response.headers.get("location") ?? "/", accessUrl);
  if (cleanUrl.searchParams.has("access_token")) {
    throw new Error("Hermes Dashboard redirect retained the one-time access token.");
  }
  const page = await fetchImplementation(new URL("/chat", cleanUrl), {
    headers: { cookie },
  });
  if (!page.ok) {
    throw new Error(`Hermes independent Chat UI returned HTTP ${page.status}.`);
  }
  const dashboardSessionToken = hermesSessionToken(await page.text());
  if (!dashboardSessionToken) {
    throw new Error("Hermes independent Chat UI did not provide its WebSocket session token.");
  }
  const replay = await fetchImplementation(accessUrl, { redirect: "manual" });
  if (replay.status !== 401) {
    throw new Error(`Hermes one-time Dashboard URL replay returned HTTP ${replay.status}, expected 401.`);
  }
  return {
    cookie,
    dashboardSessionToken,
    dashboardUrl: cleanUrl,
    pageStatus: page.status,
  };
}

function openSocket(url, cookie, origin, WebSocketImplementation) {
  return new WebSocketImplementation(url, {
    headers: { cookie, origin },
  });
}

function waitForOpen(socket, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} WebSocket did not open.`)),
      timeoutMs,
    );
    socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      reject(new Error(`${label} WebSocket returned HTTP ${response.statusCode}.`));
    });
  });
}

export async function runHermesDashboardTurn({
  cookie,
  dashboardSessionToken,
  dashboardUrl,
  prompt,
  requiredTools = [],
  responseIncludes = [],
  timeoutMs = 180_000,
  WebSocketImplementation = WebSocket,
}) {
  const channel = `tali-e2e-${crypto.randomUUID()}`;
  const origin = new URL(dashboardUrl).origin;
  const events = [];
  let terminalOutput = "";
  const eventsSocket = openSocket(
    websocketUrl(dashboardUrl, "/api/events", {
      channel,
      token: dashboardSessionToken,
    }),
    cookie,
    origin,
    WebSocketImplementation,
  );
  await waitForOpen(eventsSocket, "Hermes events", Math.min(timeoutMs, 15_000));

  const completion = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(
        `Hermes Chat turn timed out. Tools: ${eventToolNames(events).join(", ") || "none"}.`,
      ));
    }, timeoutMs);
    eventsSocket.on("message", (raw) => {
      try {
        const frame = JSON.parse(raw.toString());
        if (frame?.method !== "event" || !frame.params?.type) return;
        events.push(frame.params);
        if (frame.params.type === "error") {
          clearTimeout(timer);
          reject(new Error(`Hermes Chat event error: ${JSON.stringify(frame.params.payload)}`));
        }
        if (frame.params.type === "message.complete") {
          clearTimeout(timer);
          resolve(frame.params.payload ?? {});
        }
      } catch {
        // The events endpoint is JSON-only. Ignore an unrelated malformed frame.
      }
    });
  });

  const ptySocket = openSocket(
    websocketUrl(dashboardUrl, "/api/pty", {
      attach: crypto.randomUUID(),
      channel,
      fresh: "1",
      token: dashboardSessionToken,
    }),
    cookie,
    origin,
    WebSocketImplementation,
  );
  ptySocket.on("message", (raw) => {
    terminalOutput += raw.toString();
  });
  await waitForOpen(ptySocket, "Hermes PTY", Math.min(timeoutMs, 15_000));
  ptySocket.send(terminalResize(120, 40));
  await eventually(
    () => hermesTuiReady(terminalOutput),
    {
      description: "the Hermes Dashboard TUI to become interactive",
      intervalMs: 250,
      timeoutMs: Math.min(timeoutMs, 120_000),
    },
  );
  ptySocket.send(terminalPrompt(prompt));
  // Hermes' Ink input parser deliberately coalesces burst text. Keeping Enter
  // in the same WebSocket frame can make it part of the burst instead of a
  // submission key, so mirror a human keystroke boundary.
  await new Promise((resolve) => setTimeout(resolve, 500));
  ptySocket.send("\r");

  try {
    const payload = await completion;
    const tools = eventToolNames(events);
    const missingTools = requiredTools.filter((name) => !tools.includes(name));
    if (missingTools.length) {
      throw new Error(`Hermes did not invoke required tools: ${missingTools.join(", ")}.`);
    }
    const completedTools = completedToolEvents(events);
    const incompleteTools = requiredTools.filter(
      (name) => !completedTools.some((event) => event?.payload?.name === name),
    );
    if (incompleteTools.length) {
      throw new Error(`Hermes did not complete required tools: ${incompleteTools.join(", ")}.`);
    }
    const a2aCall = completedTools.find((event) => event?.payload?.name === "a2a_call");
    if (a2aCall && a2aCall.payload?.result?.ok !== true) {
      throw new Error(`Hermes A2A call did not return ok=true: ${JSON.stringify(a2aCall.payload?.result)}.`);
    }
    const response = String(payload.text ?? "");
    const missingText = responseIncludes.filter((marker) => !response.includes(marker));
    if (missingText.length) {
      throw new Error(`Hermes response omitted required evidence: ${missingText.join(", ")}.`);
    }
    return {
      events,
      response,
      terminalOutput: stripAnsi(terminalOutput),
      tools,
    };
  } finally {
    ptySocket.close();
    eventsSocket.close();
  }
}

export async function probeRelayTerminal({
  baseUrl,
  websocketPath,
  timeoutMs = 30_000,
  WebSocketImplementation = WebSocket,
}) {
  const url = websocketUrl(baseUrl, websocketPath);
  const socket = new WebSocketImplementation(url);
  return new Promise((resolve, reject) => {
    let output = "";
    let runtimeConnected = false;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Relay TTY did not produce an Agent frame: ${stripAnsi(output).slice(-500)}`));
    }, timeoutMs);
    socket.on("message", (raw) => {
      const chunk = raw.toString();
      output += chunk;
      if (chunk.startsWith("Connected to NemoClaw runtime")) {
        runtimeConnected = true;
        return;
      }
      if (runtimeConnected && chunk.length > 0) {
        clearTimeout(timer);
        socket.close();
        resolve(stripAnsi(output));
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function runRelayTerminalInference({
  agentPlatform,
  baseUrl,
  websocketPath,
  expectedText,
  prompt,
  timeoutMs = 180_000,
  WebSocketImplementation = WebSocket,
}) {
  const url = websocketUrl(baseUrl, websocketPath);
  const socket = new WebSocketImplementation(url);
  return new Promise((resolve, reject) => {
    let output = "";
    let runtimeConnected = false;
    let promptSent = false;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(
        `Relay TTY inference did not return ${expectedText}: ${stripAnsi(output).slice(-1_000)}`,
      ));
    }, timeoutMs);
    socket.on("message", (raw) => {
      const chunk = raw.toString();
      output += chunk;
      if (chunk.startsWith("Connected to NemoClaw runtime")) {
        runtimeConnected = true;
        return;
      }
      if (
        runtimeConnected
        && !promptSent
        && inferenceTuiReady(output, agentPlatform)
      ) {
        promptSent = true;
        socket.send(terminalResize(120, 40));
        socket.send(terminalPrompt(prompt));
        // Interactive TUIs can coalesce a burst containing both text and
        // Enter into one edit operation. Preserve a real keystroke boundary
        // so OpenClaw, Hermes, and Deep Agents all submit the prompt.
        setTimeout(() => socket.send("\r"), 500);
        return;
      }
      if (promptSent && stripAnsi(output).includes(expectedText)) {
        clearTimeout(timer);
        socket.close();
        resolve(stripAnsi(output));
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function expectWebSocketHttpStatus({
  baseUrl,
  websocketPath,
  expectedStatus,
  timeoutMs = 15_000,
  WebSocketImplementation = WebSocket,
}) {
  const socket = new WebSocketImplementation(websocketUrl(baseUrl, websocketPath));
  return new Promise((resolve, reject) => {
    let receivedStatus = false;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`WebSocket did not reject with HTTP ${expectedStatus}.`));
    }, timeoutMs);
    socket.once("open", () => {
      clearTimeout(timer);
      socket.close();
      reject(new Error(`WebSocket unexpectedly opened; expected HTTP ${expectedStatus}.`));
    });
    socket.once("unexpected-response", (_request, response) => {
      receivedStatus = true;
      clearTimeout(timer);
      socket.close();
      if (response.statusCode !== expectedStatus) {
        reject(new Error(
          `WebSocket returned HTTP ${response.statusCode}; expected ${expectedStatus}.`,
        ));
        return;
      }
      resolve(response.statusCode);
    });
    socket.once("error", (error) => {
      // ws emits both unexpected-response and error on some versions. The
      // status callback owns the assertion when the HTTP response is visible.
      if (!receivedStatus) {
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

export async function waitForInstanceModelAttribution({
  instance,
  projectRequest,
  routing,
  startedAt,
  timeoutMs = 180_000,
}) {
  if (instance.modelRoutingId !== routing.id) {
    throw new Error(
      `Instance ${instance.id} was assigned Routing ${instance.modelRoutingId}, expected ${routing.id}.`,
    );
  }
  if (routing.routingPolicy?.mode !== "SINGLE") {
    throw new Error("Model attribution requires the cost-safe SINGLE Routing used by live E2E.");
  }
  const modelPage = await projectRequest("/models");
  const deployment = (modelPage.data ?? modelPage).find(
    (candidate) => candidate.id === routing.routingPolicy.modelDeploymentId,
  );
  if (!deployment) {
    throw new Error(
      `Routing ${routing.id} references missing Model Deployment ${routing.routingPolicy.modelDeploymentId}.`,
    );
  }
  const routingAssignment = `model-routing:${routing.id}`;
  if (
    instance.modelDeploymentId !== deployment.id
    && instance.modelDeploymentId !== routingAssignment
  ) {
    throw new Error(
      `Instance ${instance.id} was assigned Model Deployment ${instance.modelDeploymentId}, expected ${deployment.id} or ${routingAssignment}.`,
    );
  }
  const start = new Date(new Date(startedAt).getTime() - 60_000).toISOString();
  const item = await eventually(async () => {
    const end = new Date(Date.now() + 60_000).toISOString();
    const query = new URLSearchParams({
      start_time: start,
      end_time: end,
      timezone: "UTC",
      filters: JSON.stringify({ instance: [instance.id] }),
      group_by: "instance",
      page: "1",
      page_size: "25",
    });
    const page = await projectRequest(`/costs/breakdown?${query}`);
    return page.items?.find(
      (candidate) => candidate.id === instance.id && candidate.requests > 0,
    );
  }, {
    description: `LiteLLM cost attribution for ${instance.agentPlatform ?? instance.id}`,
    intervalMs: 3_000,
    timeoutMs,
  });
  const expectedNames = [deployment.modelId, deployment.litellmModelName]
    .filter((value) => typeof value === "string" && value.length > 0);
  if (!expectedNames.some((name) => item.detail === name || item.detail.includes(name))) {
    throw new Error(
      `LiteLLM attributed ${instance.id} to ${item.detail}; expected ${expectedNames.join(" or ")}.`,
    );
  }
  return {
    instanceId: instance.id,
    model: item.detail,
    modelDeploymentId: deployment.id,
    assignedModelDeploymentId: instance.modelDeploymentId,
    requests: item.requests,
    routingId: routing.id,
  };
}
