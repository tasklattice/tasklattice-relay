import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { LiteLLMClient, type LiteLLMVirtualKey } from "./litellm-client";

// Enabled only by scripts/testing/integration-litellm.mjs's disposable stack.
let base = process.env.RELAY_LITELLM_TEST_URL;
describe.skipIf(!base).sequential("Relay against the Chart's real LiteLLM gateway", () => {
  const master = process.env.RELAY_LITELLM_TEST_KEY!;
  let client = new LiteLLMClient(base!, master);
  const version = process.env.RELAY_LITELLM_TEST_VERSION;
  const project = `relay-test-${randomUUID()}`;
  const modelId = randomUUID();
  const otherModelId = randomUUID();
  const day = new Date().toISOString().slice(0, 10);
  let model: string;
  let otherModel: string;
  let team: string;
  let key: LiteLLMVirtualKey;
  const request = (path: string, token = master, body?: unknown) => fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = async (path: string) => {
    const response = await request(path);
    expect(response.status, path).toBe(200);
    return response.json();
  };
  const completion = (token: string, target = model, stream = false) => request("/v1/chat/completions", token, {
    model: target, messages: [{ role: "user", content: "Relay contract test" }], stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  });
  const register = (registrationId: string) => client.registerModel({
    registrationId, accountId: project, providerKind: "custom-openai-compatible",
    model: { modelId: "gpt-4o-mini", displayName: "Local deterministic model", modelType: "llm",
      inputFeePerMillionTokens: 1, outputFeePerMillionTokens: 2 },
    litellmParams: { model: "openai/gpt-4o-mini", api_key: "synthetic-test-only",
      mock_response: "Relay integration response" },
    complianceDomain: "GLOBAL", endpointRegion: "US",
  });

  beforeAll(async () => {
    model = await register(modelId);
    otherModel = await register(otherModelId);
    team = await client.ensureProjectTeam(project, { managed_by: "tali" });
    await client.updateProjectTeam(team, { maxBudget: 1, budgetDuration: "1d", tpmLimit: 10000 });
    await client.updateProjectObjectPermissions(team, { mcpServers: [] });
    key = await client.createInstanceServiceAccountKey({ alias: project, duration: "1h", teamId: team,
      models: [model], metadata: { managed_by: "tali" }, objectPermissions: { mcpServers: [] } });
  }, 60_000);

  it("discovers the version through authenticated details and keeps public probes working", async () => {
    await expect(client.testConnection()).resolves.toEqual({ ok: true, version });
    expect((await fetch(base + "/health/readiness")).status).toBe(200);
    expect((await fetch(base + "/health/liveliness")).status).toBe(200);
    expect([401, 403]).toContain((await fetch(base + "/health/readiness/details")).status);
    expect((await fetch(base + "/ui/")).status).toBe(200);
  });

  it("persists model metadata, project quotas and instance permissions through Relay APIs", async () => {
    await client.probeModel(model, "llm");
    expect(await client.ensureProjectTeam(project, { managed_by: "tali" })).toBe(team);
    const inspection = await client.inspectModelRouting(model);
    expect(inspection).toMatchObject({ exists: true, version, modelCount: 1,
      complianceDomains: ["GLOBAL"], complianceUnknown: false });
    const info = await json(`/team/info?team_id=${encodeURIComponent(team)}`);
    expect(info.team_info).toMatchObject({ max_budget: 1, budget_duration: "1d", tpm_limit: 10000 });
    await client.updateInstanceObjectPermissions(key.tokenId, { mcpServers: [] });
    const instance = await json(`/key/info?key=${encodeURIComponent(key.tokenId)}`);
    expect(instance.info).toMatchObject({ team_id: team, models: [model] });
  });

  it("serves scoped completions and SSE, rejects other existing models and persists spend", async () => {
    const response = await completion(key.secret);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toBe("Relay integration response");
    expect(body.usage.total_tokens).toBeGreaterThan(0);
    const streaming = await completion(key.secret, model, true);
    expect(streaming.status).toBe(200);
    expect(streaming.headers.get("content-type")).toContain("text/event-stream");
    const sse = await streaming.text();
    expect(sse).toContain("data: [DONE]");
    const chunks = sse.split("\n").filter(line => line.startsWith("data: ") && !line.includes("[DONE]"))
      .map(line => JSON.parse(line.slice(6)));
    expect(chunks.map(chunk => chunk.choices?.[0]?.delta?.content ?? "").join("")).toBe("Relay integration response");
    expect(chunks.some(chunk => chunk.usage?.total_tokens > 0)).toBe(true);
    expect([401, 403]).toContain((await completion(key.secret, otherModel)).status);
    await expect.poll(async () => {
      const logs = await client.listSpendLogs(day, new Date().toISOString().slice(0, 10), team);
      return logs.filter(log => log.team_id === team && Number(log.total_tokens) > 0 && Number(log.spend) > 0).length;
    }, { timeout: 120_000, interval: 1000 }).toBeGreaterThanOrEqual(2);
    expect(await client.listSpendLogs(day, day, randomUUID())).toEqual([]);
  }, 150_000);

  it("retains models, keys and spend after a real process restart", async () => {
    const container = process.env.RELAY_LITELLM_TEST_CONTAINER!;
    expect(container).toMatch(/^relay-litellm-it-[\da-f]{8}$/);
    execFileSync("docker", ["restart", container], { stdio: "pipe", timeout: 60_000 });
    // Docker may allocate a different ephemeral host port after a restart.
    const address = execFileSync("docker", ["port", container, "4000/tcp"], { encoding: "utf8", timeout: 10_000 }).trim();
    expect(address).toMatch(/^127\.0\.0\.1:\d+$/);
    base = `http://${address}`;
    client = new LiteLLMClient(base, master);
    await expect.poll(async () => {
      try { return (await client.testConnection()).version; } catch { return undefined; }
    }, { timeout: 120_000, interval: 1000 }).toBe(version);
    expect((await client.inspectModelRouting(model)).exists).toBe(true);
    expect((await completion(key.secret)).status).toBe(200);
    expect((await client.listSpendLogs(day, new Date().toISOString().slice(0, 10), team)).length).toBeGreaterThanOrEqual(2);
  }, 180_000);

  it("blocks and revokes active keys and removes the managed models and team", async () => {
    await client.blockKey(key.tokenId);
    expect([401, 403]).toContain((await completion(key.secret)).status);
    await client.revokeKey(key.tokenId);
    expect([401, 403]).toContain((await completion(key.secret)).status);
    const revoked = await client.createInstanceServiceAccountKey({ alias: project + "-revoke", teamId: team,
      models: [model], metadata: { managed_by: "tali" }, objectPermissions: { mcpServers: [] } });
    expect((await completion(revoked.secret)).status).toBe(200);
    await client.revokeKey(revoked.tokenId);
    expect([401, 403]).toContain((await completion(revoked.secret)).status);
    await client.deleteModelById(modelId);
    await client.deleteModel(otherModel);
    expect((await client.inspectModelRouting(model)).exists).toBe(false);
    expect((await client.inspectModelRouting(otherModel)).exists).toBe(false);
    await client.deleteProjectTeam(team);
    const teams = await json("/team/list");
    expect((Array.isArray(teams) ? teams : teams.data).some((item: { team_id: string }) => item.team_id === team)).toBe(false);
  }, 60_000);
});
