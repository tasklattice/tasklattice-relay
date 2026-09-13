#!/usr/bin/env node

import { RelayClient } from "./live-hermes-e2e-lib.mjs";

const baseUrl = process.env.TALI_BASE_URL ?? "http://127.0.0.1:18080";
const projectId = process.env.TALI_LIVE_EXPERT_AGENT_PROJECT_ID ?? "proj1";
const username = process.env.TALI_VALIDATION_USERNAME ?? "admin";
const password = process.env.TALI_VALIDATION_PASSWORD ?? "password";
const slug = process.env.TALI_LIVE_EXPERT_AGENT_SLUG?.trim();

if (process.env.TALI_LIVE_AGENT_RELEASE !== "1") {
  throw new Error(
    "Set TALI_LIVE_AGENT_RELEASE=1 to authorize Test, Publish, and Instance creation for one Agent.",
  );
}
if (!slug) throw new Error("Set TALI_LIVE_EXPERT_AGENT_SLUG to the exact Agent slug.");

function items(value) {
  return Array.isArray(value) ? value : value?.data ?? [];
}

async function main() {
  const client = new RelayClient(baseUrl);
  await client.login(username, password);
  await client.request("/api/v1/access-context", {
    method: "PUT",
    body: JSON.stringify({
      level: "project",
      resourceId: projectId,
      roleId: "ROLE_AGENT_DEVELOPER",
    }),
  });

  const agents = items(await client.project(projectId, "/agents"));
  const agent = agents.find((candidate) => candidate.slug === slug);
  if (!agent) throw new Error(`Agent ${slug} was not found in Project ${projectId}.`);
  const path = `/agents/${encodeURIComponent(agent.id)}`;
  let detail = await client.project(projectId, path);

  let testRun = detail.testRuns.find((run) =>
    run.contentDigest === detail.contentDigest && run.status === "PASSED"
  );
  if (!testRun) {
    testRun = await client.project(projectId, `${path}/test-runs`, {
      method: "POST",
      body: "{}",
    });
    if (testRun.status !== "PASSED") {
      throw new Error(`Agent Test failed: ${testRun.evidence?.summary ?? "no summary"}`);
    }
    detail = await client.project(projectId, path);
  }

  let version = detail.latestVersion?.contentDigest === detail.contentDigest
    ? detail.latestVersion
    : await client.project(projectId, `${path}/publications`, {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: detail.revision,
        publicationNotes: "Validated by the local Define → Test → Publish flow.",
      }),
    });
  detail = await client.project(projectId, path);
  version = detail.latestVersion ?? version;
  if (!version?.id || version.contentDigest !== detail.contentDigest) {
    throw new Error("Publish did not create an immutable Version for the tested definition.");
  }

  let garden = await client.project(projectId, "/agent-garden");
  const gardenAgent = garden.agents.find((candidate) =>
    candidate.source === "PROJECT_DEVELOPED"
    && candidate.distribution?.type === "VERSION_BUNDLE"
    && candidate.distribution.agentId === agent.id
  );
  if (!gardenAgent) throw new Error("Published Agent is missing from Agent Garden.");
  let instance = garden.instances.find((candidate) =>
    candidate.agentId === agent.id && candidate.versionId === version.id
  );
  if (!instance) {
    instance = await client.project(
      projectId,
      `/agent-garden/agents/${encodeURIComponent(gardenAgent.id)}/instances`,
      { method: "POST", body: JSON.stringify({ versionId: version.id }) },
    );
    garden = await client.project(projectId, "/agent-garden");
    instance = garden.instances.find((candidate) => candidate.id === instance.id) ?? instance;
  }
  if (instance.status !== "READY" || !instance.endpoint || !instance.agentCardUrl) {
    throw new Error(`Instance is ${instance.status}; its A2A interface is not ready.`);
  }

  console.log(JSON.stringify({
    projectId,
    agent: { id: agent.id, slug, revision: detail.revision },
    test: { id: testRun.id, status: testRun.status, contentDigest: testRun.contentDigest },
    publish: { versionId: version.id, versionNumber: version.versionNumber, contentDigest: version.contentDigest },
    agentGarden: { agentId: gardenAgent.id, source: gardenAgent.source },
    instance: {
      id: instance.id,
      status: instance.status,
      endpoint: instance.endpoint,
      agentCardUrl: instance.agentCardUrl,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
