#!/usr/bin/env node

import { eventually, RelayClient } from "./live-hermes-e2e-lib.mjs";

const baseUrl = process.env.TALI_BASE_URL ?? "http://127.0.0.1:18080";
const projectId = process.env.TALI_LIVE_EXPERT_AGENT_PROJECT_ID ?? "proj1";
const username = process.env.TALI_VALIDATION_USERNAME ?? "admin";
const password = process.env.TALI_VALIDATION_PASSWORD ?? "password";
const slug = process.env.TALI_LIVE_EXPERT_AGENT_SLUG?.trim();

if (process.env.TALI_LIVE_AGENT_RELEASE !== "1") {
  throw new Error(
    "Set TALI_LIVE_AGENT_RELEASE=1 to authorize regression, Candidate validation, immutable publication, and activation.",
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

  const agents = items(await client.project(projectId, "/expert-agents"));
  const agent = agents.find((candidate) => candidate.slug === slug);
  if (!agent) throw new Error(`Agent ${slug} was not found in the relation-scoped list.`);
  const path = `/expert-agents/${encodeURIComponent(agent.id)}`;
  const initial = await client.project(projectId, path);
  let regression = initial.workingCopyEvaluations.find((evaluation) =>
    evaluation.workingCopyRevision === initial.workingCopy?.revision
    && evaluation.status === "PASSED"
  );
  let candidate = initial.candidates.find((item) =>
    item.workingCopyRevision === initial.workingCopy?.revision
    && item.readiness?.ready
  );
  let validations = candidate?.validations ?? [];

  if (!candidate) {
    regression = await client.project(projectId, `${path}/working-copy/evaluate`, {
      method: "POST",
      body: "{}",
    });
    if (regression.status !== "PASSED") {
      throw new Error(
        `Working Copy r${regression.workingCopyRevision} regression ${regression.status}: ${regression.evidence?.summary ?? "no summary"}`,
      );
    }

    candidate = await client.project(projectId, `${path}/candidates`, {
      method: "POST",
      body: "{}",
    });
    const validationPage = await client.project(
      projectId,
      `${path}/candidates/${encodeURIComponent(candidate.id)}/validate`,
      { method: "POST", body: "{}" },
    );
    validations = items(validationPage);
    const failing = validations.filter((validation) => validation.status !== "PASSED");
    if (failing.length) {
      throw new Error(
        `Candidate validation failed: ${failing.map((item) => `${item.kind}:${item.status}`).join(", ")}`,
      );
    }
  }
  const candidateDetail = await client.project(
    projectId,
    `${path}/candidates/${encodeURIComponent(candidate.id)}`,
  );
  if (!candidateDetail.readiness?.ready) {
    throw new Error(
      `Candidate is not publishable: ${[...(candidateDetail.readiness?.missing ?? []), ...(candidateDetail.readiness?.failing ?? []), ...(candidateDetail.readiness?.stale ?? [])].join(", ")}`,
    );
  }
  if (!regression) {
    throw new Error("A publishable Candidate has no matching passed Working Copy regression receipt.");
  }

  const version = candidateDetail.versionId
    ? (initial.versions.find((item) => item.id === candidateDetail.versionId)
      ?? items(await client.project(projectId, `${path}/versions`))
        .find((item) => item.id === candidateDetail.versionId))
    : await client.project(
      projectId,
      `${path}/candidates/${encodeURIComponent(candidate.id)}/publish`,
      { method: "POST", body: "{}" },
    );
  if (!version) throw new Error("Published Version could not be read.");
  const beforeActivation = await client.project(projectId, path);
  const alreadyActive = beforeActivation.deployment?.status === "READY"
    && beforeActivation.deployment?.activeVersionId === version.id;
  const activation = alreadyActive
    ? { id: "already-active", status: "READY" }
    : await client.project(projectId, `${path}/activations`, {
      method: "POST",
      body: JSON.stringify({
        action: "ACTIVATE",
        targetVersionId: version.id,
        expectedDeploymentRevision: beforeActivation.deployment?.revision ?? 0,
        reason: "Release 0 end-to-end validation",
      }),
    });
  const active = await eventually(async () => {
    const detail = await client.project(projectId, path);
    if (
      detail.deployment?.status === "READY"
      && detail.deployment?.activeVersionId === version.id
    ) return detail;
    if (detail.deployment?.status === "FAILED") {
      throw new Error("Activation reconciled to FAILED.");
    }
    return undefined;
  }, {
    description: `${slug} activation`,
    intervalMs: 1_000,
    timeoutMs: 180_000,
  });

  console.log(JSON.stringify({
    projectId,
    agent: { id: agent.id, slug },
    regression: {
      id: regression.id,
      revision: regression.workingCopyRevision,
      status: regression.status,
      suiteCount: regression.evidence?.evaluationSuites?.length ?? 0,
    },
    candidate: {
      id: candidate.id,
      digest: candidate.contentDigest,
      validations: validations.map(({ kind, status }) => ({ kind, status })),
    },
    version: {
      id: version.id,
      releaseId: version.releaseId,
      digest: version.contentDigest,
    },
    activation: {
      id: activation.id,
      queuedStatus: activation.status,
      deploymentStatus: active.deployment.status,
      deploymentRevision: active.deployment.revision,
      activeVersionId: active.deployment.activeVersionId,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
