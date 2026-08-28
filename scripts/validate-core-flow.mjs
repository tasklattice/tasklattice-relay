import {
  probeRelayTerminal,
  runRelayTerminalInference,
  waitForInstanceModelAttribution,
} from "./testing/live-hermes-e2e-lib.mjs";

const baseUrl = process.env.TALI_BASE_URL ?? "http://127.0.0.1:18080";
const expectNemoClawRuntime = process.env.TALI_EXPECT_NEMOCLAW_RUNTIME === "1";
const keepValidationAgent = process.env.TALI_VALIDATION_KEEP_AGENT === "1";
const validateInference = process.env.TALI_VALIDATION_INFERENCE === "1";
const validationUsername =
  process.env.TALI_VALIDATION_USERNAME ?? "admin";
const validationPassword =
  process.env.TALI_VALIDATION_PASSWORD ?? "password";
const validationAgentPlatform =
  process.env.TALI_VALIDATION_AGENT_PLATFORM ?? "hermes";
const validationProjectId = process.env.TALI_VALIDATION_PROJECT_ID;
const validationAgentId = process.env.TALI_VALIDATION_AGENT_ID;
const validationTimeoutMs = Number(
  process.env.TALI_VALIDATION_TIMEOUT_MS ?? "180000",
);
if (!Number.isFinite(validationTimeoutMs) || validationTimeoutMs <= 0)
  throw new Error("TALI_VALIDATION_TIMEOUT_MS must be a positive number.");
const validationPollAttempts = Math.ceil(validationTimeoutMs / 1_000);
let sessionCookie = "";

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      ...init?.headers,
    },
  });
  const body = await response.text();
  let payload;
  try {
    payload = body ? JSON.parse(body) : undefined;
  } catch {
    throw new Error(
      `Expected JSON from ${path}, received ${response.status} ${response.headers.get("content-type") ?? "without a content type"}.`,
    );
  }
  if (!response.ok)
    throw new Error(payload?.error ?? payload?.detail ?? `HTTP ${response.status}`);
  return payload;
}

const loginResponse = await fetch(`${baseUrl}/api/auth/sign-in/username`, {
  headers: {
    "content-type": "application/json",
    origin: baseUrl,
  },
  method: "POST",
  body: JSON.stringify({
    password: validationPassword,
    rememberMe: false,
    username: validationUsername,
  }),
});
if (!loginResponse.ok) {
  const payload = await loginResponse.json();
  throw new Error(payload.message ?? `Login failed (${loginResponse.status}).`);
}
sessionCookie = (loginResponse.headers.get("set-cookie") ?? "")
  .split(/,(?=\s*[^;,]+=)/)
  .map((cookie) => cookie.split(";", 1)[0]?.trim())
  .filter(Boolean)
  .join("; ");

const projects = await request("/api/v1/projects");
const project = validationProjectId
  ? projects.find((candidate) => candidate.id === validationProjectId)
  : projects[0];
if (!project)
  throw new Error(
    validationProjectId
      ? `Validation Project ${validationProjectId} is unavailable.`
      : "No Project is available for core-flow validation.",
  );
await request("/api/v1/access-context", {
  method: "PUT",
  body: JSON.stringify({
    level: "project",
    resourceId: project.id,
    roleId: "ROLE_PROJECT_ADMIN",
  }),
});
const projectBasePath = `/api/v1/projects/${encodeURIComponent(project.id)}`;
const projectRequest = (path, init) => request(`${projectBasePath}${path}`, init);
const unwrapAgent = (payload) => payload?.instance ?? payload;

async function fetchAuthenticatedEndpoint(url) {
  let response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get("location");
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!location || !cookie) return response;
  response = await fetch(new URL(location, url), {
    headers: { cookie },
    signal: AbortSignal.timeout(10_000),
  });
  return response;
}

const routings = await projectRequest("/model-routings");
const validatedRouting = routings.data.find(
  (routing) => routing.status === "READY"
    && (!validateInference || (
      routing.routingPolicy?.mode === "SINGLE"
      && !(routing.routingPolicy.fallbackModelDeploymentIds ?? []).length
      && (routing.routingPolicy.retries ?? 0) <= 2
    )),
);
if (!validatedRouting)
  throw new Error(
    validateInference
      ? "No cost-safe READY SINGLE Model Routing is available for live inference."
      : "No READY Model Routing is available for Instance creation.",
  );
const accessPolicies = await projectRequest("/access-policies");
const activeAccessPolicy = accessPolicies.data.find(
  (policy) => policy.status === "ACTIVE",
);
if (!activeAccessPolicy)
  throw new Error("No ACTIVE Access Policy is available for Instance creation.");

const validationStartedAt = new Date().toISOString();
const creation = validationAgentId
  ? await projectRequest(`/instances/${encodeURIComponent(validationAgentId)}`)
  : await projectRequest("/instances", {
      method: "POST",
      body: JSON.stringify({
        name: `validation-${Date.now().toString().slice(-6)}`,
        description: "REST and terminal contract validation",
        runtime: "openshell",
        agentPlatform: validationAgentPlatform,
        accessPolicyIds: [activeAccessPolicy.id],
        modelRoutingId: validatedRouting.id,
        systemPrompt: "You are a validation agent. Report runtime evidence clearly.",
      }),
    });

const createdId = validationAgentId
  ? unwrapAgent(creation)?.id
  : creation.instanceId;
if (!createdId)
  throw new Error(`Instance creation did not return an Instance ID: ${JSON.stringify(creation)}`);
let agent = validationAgentId
  ? unwrapAgent(creation)
  : unwrapAgent(await projectRequest(`/instances/${encodeURIComponent(createdId)}`));
for (
  let attempt = 0;
  attempt < validationPollAttempts && agent.status === "PROVISIONING";
  attempt += 1
) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  agent = unwrapAgent(
    await projectRequest(`/instances/${encodeURIComponent(createdId)}`),
  );
}
if (agent.status !== "READY") throw new Error(`Agent did not become READY: ${JSON.stringify(agent)}`);

let httpEndpointEvidence;
let interactionEndpoint;
const expectsHttpEndpoint =
  expectNemoClawRuntime && validationAgentPlatform !== "deepagents";
if (expectsHttpEndpoint) {
  const interaction = await projectRequest(`/instances/${agent.id}/interaction`);
  interactionEndpoint = interaction.httpEndpoint;
  if (interactionEndpoint?.status !== "READY" || !interactionEndpoint.url)
    throw new Error(`NemoClaw HTTP Endpoint unavailable: ${JSON.stringify(interactionEndpoint)}`);
  const endpointResponse = await fetchAuthenticatedEndpoint(
    interactionEndpoint.url,
  );
  if (!endpointResponse.ok)
    throw new Error(`NemoClaw HTTP Endpoint returned ${endpointResponse.status}.`);
  httpEndpointEvidence = `${interactionEndpoint.kind} returned HTTP ${endpointResponse.status}.`;
} else if (expectNemoClawRuntime) {
  const interaction = await projectRequest(`/instances/${agent.id}/interaction`);
  if (interaction.httpEndpoint !== undefined)
    throw new Error(
      `Terminal-only Agent unexpectedly exposed an HTTP Endpoint: ${JSON.stringify(interaction.httpEndpoint)}`,
    );
  httpEndpointEvidence = `${validationAgentPlatform} is terminal-only; no HTTP Endpoint was published.`;
} else {
  httpEndpointEvidence = "Not required for the fixture runtime.";
}

const runtime = await projectRequest("/runtime");
let terminalEvidence;
if (!runtime.terminal.available) {
  if (expectNemoClawRuntime)
    throw new Error(`NemoClaw TUI runtime unavailable: ${JSON.stringify(runtime)}`);
  let rejection = "";
  try {
    await projectRequest(`/instances/${agent.id}/terminal-sessions`, {
      method: "POST",
      body: JSON.stringify({ targetId: "agent" }),
    });
  } catch (error) {
    rejection = error instanceof Error ? error.message : String(error);
  }
  if (!rejection.includes("fixture runner"))
    throw new Error(`Fixture TUI session was not rejected safely: ${rejection}`);
  terminalEvidence = `TUI unavailable in ${runtime.mode}; host shell blocked before session creation.`;
} else {
  const session = await projectRequest(`/instances/${agent.id}/terminal-sessions`, {
    method: "POST",
    body: JSON.stringify({ targetId: "agent" }),
  });
  if (validateInference) {
    const left = 3_179;
    const right = 4_862;
    const expected = `RESULT-${left + right}`;
    const output = await runRelayTerminalInference({
      baseUrl,
      websocketPath: session.websocketUrl,
      expectedText: expected,
      prompt: `Add ${left} and ${right}. Reply with RESULT- followed immediately by the integer sum, with no comma and no other text.`,
      timeoutMs: validationTimeoutMs,
    });
    terminalEvidence = `${validationAgentPlatform} completed one live TTY inference and returned ${expected}. Output tail: ${output.slice(-240)}`;
  } else {
    await probeRelayTerminal({
      baseUrl,
      websocketPath: session.websocketUrl,
      timeoutMs: Math.min(validationTimeoutMs, 30_000),
    });
    terminalEvidence = `NemoClaw runtime connected and ${validationAgentPlatform} TUI produced its first PTY frame.`;
  }
}

const modelAttribution = validateInference
  ? await waitForInstanceModelAttribution({
      instance: agent,
      projectRequest,
      routing: validatedRouting,
      startedAt: validationStartedAt,
      timeoutMs: validationTimeoutMs,
    })
  : undefined;

let deleteEvidence = "Agent retained for post-validation isolation checks.";
if (!keepValidationAgent) {
  const destroyed = await projectRequest(`/instances/${agent.id}`, {
    method: "DELETE",
  });
  const retainedMemory = destroyed.retainedMemory?.id
    ? await projectRequest(
        `/memories/${encodeURIComponent(destroyed.retainedMemory.id)}`,
      )
    : undefined;
  let deletedResource;
  for (let attempt = 0; attempt < validationPollAttempts; attempt += 1) {
    deletedResource = await fetch(
      `${baseUrl}${projectBasePath}/instances/${agent.id}`,
      { headers: { cookie: sessionCookie } },
    );
    if (deletedResource.status === 404) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const deletedEndpoint = interactionEndpoint?.url
    ? await fetch(interactionEndpoint.url)
    : undefined;
  if (
    destroyed.status !== "DESTROYING"
    || destroyed.accepted !== true
    || deletedResource?.status !== 404
    || (destroyed.retainedMemory && retainedMemory?.id !== destroyed.retainedMemory.id)
  ) {
    throw new Error(
      `Instance delete contract failed: ${JSON.stringify({
        destroyed,
        getStatus: deletedResource?.status ?? "no response",
      })}`,
    );
  }
  if (
    expectNemoClawRuntime
    && interactionEndpoint?.url
    && deletedEndpoint?.status !== 404
  )
    throw new Error(`Deleted HTTP Endpoint returned ${deletedEndpoint?.status ?? "no response"}.`);
  const memoryEvidence = retainedMemory?.id
    ? `Memory ${retainedMemory.id} retained`
    : "no durable Memory attached";
  deleteEvidence = `${destroyed.status} accepted / Instance GET ${deletedResource.status} / Endpoint GET ${deletedEndpoint?.status ?? "N/A"} / ${memoryEvidence}`;
}

console.log(JSON.stringify({
  result: "PASS",
  projectId: project.id,
  agentId: agent.id,
  sandboxName: agent.sandboxName,
  status: agent.status,
  runtime: agent.runtime,
  provider: agent.providerName,
  httpEndpointEvidence,
  terminalEvidence: String(terminalEvidence).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").trim(),
  modelAttribution,
  deleteEvidence,
}, null, 2));
