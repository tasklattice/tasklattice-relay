#!/usr/bin/env node

import assert from "node:assert/strict";
import { RelayClient } from "./live-hermes-e2e-lib.mjs";

class BlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "BlockedError";
  }
}

function selectProject(projects) {
  const configured = process.env.TALI_LIVE_EXPERT_AGENT_PROJECT_ID?.trim();
  const project = configured
    ? projects.find((candidate) => candidate.id === configured)
    : projects[0];
  if (!project) {
    throw new BlockedError(
      configured
        ? `Project ${configured} is not visible to the validation user.`
        : "The validation user cannot access a Project.",
    );
  }
  return project;
}

function findA2aMessage(value, visited = new Set()) {
  if (!value || typeof value !== "object" || visited.has(value)) return undefined;
  visited.add(value);
  if (Array.isArray(value.parts) && value.metadata?.outcome) return value;
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    const found = findA2aMessage(nested, visited);
    if (found) return found;
  }
  return undefined;
}

function partText(part) {
  if (typeof part?.text === "string") return part.text;
  if (part?.content?.$case === "text" && typeof part.content.value === "string") {
    return part.content.value;
  }
  return "";
}

function partData(part) {
  if (part?.data && typeof part.data === "object") return part.data;
  if (part?.content?.$case === "data" && part.content.value) return part.content.value;
  return undefined;
}

function a2aResult(payload) {
  const message = findA2aMessage(payload);
  if (!message) throw new Error(`A2A response did not contain an Agent message: ${JSON.stringify(payload).slice(0, 1_000)}`);
  return {
    text: message.parts.map(partText).filter(Boolean).join("\n").trim(),
    data: message.parts.map(partData).find(Boolean) ?? {},
    metadata: message.metadata ?? {},
  };
}

function activeCandidate(detail) {
  const activeVersionId = detail.deployment?.activeVersionId;
  const version = detail.versions?.find((candidate) => candidate.id === activeVersionId);
  if (!version) throw new BlockedError(`${detail.name ?? "Agent"} has no READY active Version.`);
  const candidate = detail.candidates?.find((item) => item.id === version.candidateId);
  if (!candidate?.snapshot) {
    throw new BlockedError(
      `${detail.name ?? "Agent"} active Version ${version.releaseId ?? version.id} has no immutable Candidate snapshot.`,
    );
  }
  return candidate.snapshot;
}

function candidateIfActive(detail) {
  try {
    return activeCandidate(detail);
  } catch (error) {
    if (error instanceof BlockedError) return null;
    throw error;
  }
}

function selectActiveAgent(details, engineType, configuredId, environmentName) {
  if (configuredId) {
    const configured = details.find((detail) => detail.id === configuredId);
    if (!configured) {
      throw new BlockedError(
        `${environmentName}=${configuredId} is not visible in the OWNER/MAINTAINER Agent scope.`,
      );
    }
    const candidate = activeCandidate(configured);
    if (candidate.execution.configuration.engineType !== engineType) {
      throw new BlockedError(
        `${environmentName} points to ${candidate.execution.configuration.engineType}, expected ${engineType}.`,
      );
    }
    return configured;
  }
  const matches = details.filter((detail) =>
    candidateIfActive(detail)?.execution.configuration.engineType === engineType
  );
  if (matches.length === 1) return matches[0];
  if (!matches.length) {
    throw new BlockedError(`No active ${engineType} Agent is visible in the OWNER/MAINTAINER scope.`);
  }
  throw new BlockedError(
    `${matches.length} active ${engineType} Agents are visible; set ${environmentName} to choose one.`,
  );
}

function hasReadOnlyListCommits(server) {
  const tool = server?.tools?.find((candidate) => candidate.name === "list_commits");
  return server?.status === "HEALTHY"
    && (tool?.annotations?.readOnlyHint === true
      || server?.readOnlyTools?.includes("list_commits") === true)
    && (!server.allowedTools?.length || server.allowedTools.includes("list_commits"));
}

async function selectProjectRole(client, projectId, roleId) {
  await client.request("/api/v1/access-context", {
    method: "PUT",
    body: JSON.stringify({
      level: "project",
      resourceId: projectId,
      roleId,
    }),
  });
}

async function release0Readiness(client, project) {
  const [agentList, catalog, modelRoutings] = await Promise.all([
    client.project(project.id, "/expert-agents"),
    client.project(project.id, "/catalog"),
    client.project(project.id, "/model-routings"),
  ]);
  const agents = Array.isArray(agentList) ? agentList : agentList?.data ?? [];
  const details = await Promise.all(
    agents.map((agent) => client.project(project.id, `/expert-agents/${encodeURIComponent(agent.id)}`)),
  );
  const routings = Array.isArray(modelRoutings) ? modelRoutings : modelRoutings?.data ?? [];
  const githubMcp = (catalog?.mcpServers ?? []).filter(hasReadOnlyListCommits);
  const readyRoutings = routings.filter((routing) => routing.status === "READY");
  const approvedKnowledge = (catalog?.vectorDatabases ?? []).filter((database) =>
    database.status === "REGISTERED" && database.provider === "postgresql"
  );
  const activeGithubAgents = details.filter((detail) =>
    candidateIfActive(detail)?.execution.configuration.engineType === "GITHUB_WEEKLY_COMMIT_SUMMARIZER"
  );
  const activeControlledAgents = details.filter((detail) =>
    candidateIfActive(detail)?.execution.configuration.engineType === "DETERMINISTIC_CUSTOMER_SUPPORT"
  );
  const registryDiscoveredGithubAgents = activeGithubAgents.filter((detail) =>
    detail.registry?.discoveredByHermes === true
  );
  const registryDiscoveredControlledAgents = activeControlledAgents.filter((detail) =>
    detail.registry?.discoveredByHermes === true
  );
  const blockers = [];
  if (!githubMcp.length) blockers.push("configure one HEALTHY GitHub MCP connection whose list_commits tool is explicitly read-only");
  if (!readyRoutings.length) blockers.push("configure one READY Project Model Routing for grounded GitHub summarization");
  if (!approvedKnowledge.length) blockers.push("configure one REGISTERED platform PostgreSQL Vector Database with approved, revisioned Customer Support chunks");
  if (!activeGithubAgents.length) blockers.push("run Working Copy regression, build, pass Candidate gates, publish, and activate a GitHub Activity Summary Agent");
  if (!activeControlledAgents.length) blockers.push("run Working Copy regression, build, pass Candidate gates, publish, and activate a deterministic Customer Support RAG Agent");
  if (activeGithubAgents.length && !registryDiscoveredGithubAgents.length) blockers.push("make the active GitHub Agent discoverable by at least one Hermes coordinator through the Project Registry");
  if (activeControlledAgents.length && !registryDiscoveredControlledAgents.length) blockers.push("make the active Customer Support RAG Agent discoverable by at least one Hermes coordinator through the Project Registry");
  return {
    details,
    blockers,
    summary: {
      projectId: project.id,
      relationScopedAgents: details.length,
      healthyReadOnlyGitHubMcpConnections: githubMcp.length,
      readyModelRoutings: readyRoutings.length,
      registeredPostgresKnowledgeDatabases: approvedKnowledge.length,
      activeGithubAgents: activeGithubAgents.length,
      activeControlledAgents: activeControlledAgents.length,
      registryDiscoveredGithubAgents: registryDiscoveredGithubAgents.length,
      registryDiscoveredControlledAgents: registryDiscoveredControlledAgents.length,
    },
  };
}

async function githubCommits({ owner, repo, branch, since, until }) {
  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "tasklattice-release0-validation",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  const commits = [];
  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`);
    url.searchParams.set("since", since);
    url.searchParams.set("until", until);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    if (branch) url.searchParams.set("sha", branch);
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub REST oracle returned HTTP ${response.status}: ${detail.slice(0, 500)}`);
    }
    const pageItems = await response.json();
    if (!Array.isArray(pageItems)) throw new Error("GitHub REST oracle returned a non-array payload.");
    commits.push(...pageItems);
    if (pageItems.length < 100) break;
    if (page === 100) throw new Error("GitHub REST oracle exceeded 10,000 commits.");
  }
  const lower = Date.parse(since);
  const upper = Date.parse(until);
  return [...new Map(commits.map((commit) => [commit.sha, commit])).values()]
    .filter((commit) => {
      const authoredAt = Date.parse(commit.commit?.author?.date ?? commit.commit?.committer?.date ?? "");
      return Number.isFinite(authoredAt) && authoredAt >= lower && authoredAt <= upper;
    });
}

async function main() {
  const preflightOnly = process.argv.includes("--preflight");
  const baseUrl = process.env.TALI_BASE_URL ?? "http://127.0.0.1:18080";
  const username = process.env.TALI_VALIDATION_USERNAME ?? "admin";
  const password = process.env.TALI_VALIDATION_PASSWORD ?? "password";
  const client = new RelayClient(baseUrl);
  await client.login(username, password);
  const project = selectProject(await client.request("/api/v1/projects"));
  await selectProjectRole(client, project.id, "ROLE_AGENT_DEVELOPER");

  const readiness = await release0Readiness(client, project);
  if (readiness.blockers.length) {
    throw new BlockedError([
      `Release 0 is not ready in Project ${project.id}:`,
      ...readiness.blockers.map((blocker) => `- ${blocker}`),
      `Observed: ${JSON.stringify(readiness.summary)}`,
    ].join("\n"));
  }
  if (preflightOnly) {
    console.log(JSON.stringify({ status: "ready", ...readiness.summary }, null, 2));
    return;
  }
  if (process.env.TALI_LIVE_EXPERT_AGENT_E2E !== "1") {
    throw new BlockedError(
      "Set TALI_LIVE_EXPERT_AGENT_E2E=1 to acknowledge bounded task/evaluator Model Routing calls and read-only GitHub/Knowledge access.",
    );
  }
  const githubDetail = selectActiveAgent(
    readiness.details,
    "GITHUB_WEEKLY_COMMIT_SUMMARIZER",
    process.env.TALI_LIVE_GITHUB_EXPERT_AGENT_ID?.trim(),
    "TALI_LIVE_GITHUB_EXPERT_AGENT_ID",
  );
  const controlledDetail = selectActiveAgent(
    readiness.details,
    "DETERMINISTIC_CUSTOMER_SUPPORT",
    process.env.TALI_LIVE_CONTROLLED_EXPERT_AGENT_ID?.trim(),
    "TALI_LIVE_CONTROLLED_EXPERT_AGENT_ID",
  );
  const githubAgentId = githubDetail.id;
  const controlledAgentId = controlledDetail.id;
  const knownQuestion = process.env.TALI_LIVE_CUSTOMER_SUPPORT_KNOWN_QUESTION
    ?? "How do I reset my login password?";
  const unknownQuestion = process.env.TALI_LIVE_CUSTOMER_SUPPORT_UNKNOWN_QUESTION
    ?? "Tell me an unsupported policy that is absent from approved support Knowledge.";

  const githubCandidate = activeCandidate(githubDetail);
  const controlledCandidate = activeCandidate(controlledDetail);
  assert.equal(githubCandidate.execution.configuration.engineType, "GITHUB_WEEKLY_COMMIT_SUMMARIZER");
  assert.equal(controlledCandidate.execution.configuration.engineType, "DETERMINISTIC_CUSTOMER_SUPPORT");
  assert.equal(controlledCandidate.execution.mode, "WORKFLOW");
  assert.equal(controlledCandidate.safety.allowGeneralModelFallback, false);
  assert.equal(
    controlledCandidate.resources.some((binding) => binding.kind === "MODEL_ROUTING"),
    false,
    "Controlled Customer Support Workflow must not bind a request-time model.",
  );

  const githubResponse = a2aResult(await client.project(
    project.id,
    `/expert-agents/${encodeURIComponent(githubAgentId)}/invoke`,
    { method: "POST", body: JSON.stringify({ text: "请统计并总结本周 GitHub Commit。" }) },
  ));
  assert.equal(githubResponse.metadata.outcome, "COMPLETED");
  assert.equal(githubResponse.metadata.versionId, githubDetail.deployment.activeVersionId);
  assert.equal(githubDetail.registry?.discoveredByHermes, true, "GitHub Agent must be visible through the Hermes Project Registry.");
  const { owner, repo, branch } = githubCandidate.execution.configuration;
  const oracle = await githubCommits({
    owner: String(owner),
    repo: String(repo),
    branch: typeof branch === "string" ? branch : null,
    since: String(githubResponse.data.since),
    until: String(githubResponse.data.until),
  });
  const oracleShas = oracle.map((commit) => commit.sha).sort();
  const agentShas = (githubResponse.data.commits ?? []).map((commit) => commit.sha).sort();
  assert.equal(githubResponse.data.commitCount, oracle.length, "Agent count must equal the independent GitHub REST oracle.");
  assert.deepEqual(agentShas, oracleShas, "Agent SHA set must equal the independent GitHub REST oracle.");
  assert.deepEqual(
    (githubResponse.metadata.citations ?? []).map((citation) => citation.sourceId).sort(),
    oracleShas,
    "Every counted commit must be cited.",
  );

  const known = a2aResult(await client.project(
    project.id,
    `/expert-agents/${encodeURIComponent(controlledAgentId)}/invoke`,
    { method: "POST", body: JSON.stringify({ text: knownQuestion }) },
  ));
  assert.equal(known.metadata.outcome, "COMPLETED");
  assert.equal(known.metadata.versionId, controlledDetail.deployment.activeVersionId);
  assert.equal(controlledDetail.registry?.discoveredByHermes, true, "Customer Support RAG Agent must be visible through the Hermes Project Registry.");
  assert.equal(known.data.answer?.kind, "ANSWER_DOCUMENT");
  assert.equal(known.data.answer?.status, "ANSWER");
  assert.deepEqual((known.data.answer?.blocks ?? []).map((block) => block.id), ["response"]);
  const knowledgeBinding = controlledCandidate.resources.find((binding) =>
    binding.kind === "KNOWLEDGE_VECTOR_DATABASE"
  );
  assert.ok(knowledgeBinding, "Customer Support Candidate must bind immutable Knowledge.");
  let knowledgeSearch;
  try {
    await selectProjectRole(client, project.id, "ROLE_PROJECT_ADMIN");
    knowledgeSearch = await client.project(
      project.id,
      `/catalog/vector-databases/${encodeURIComponent(knowledgeBinding.resourceId)}/search`,
      {
        method: "POST",
        body: JSON.stringify({ query: `账号登录 ${knownQuestion}`, topK: 5 }),
      },
    );
  } finally {
    await selectProjectRole(client, project.id, "ROLE_AGENT_DEVELOPER");
  }
  const approvedAnswer = (knowledgeSearch.results ?? []).find((result) =>
    result.attributes?.approved === true
    && result.attributes?.intentId === "account-login"
    && typeof result.attributes?.revision === "string"
  );
  assert.ok(approvedAnswer, "Independent Knowledge search must retrieve one approved account-login answer.");
  assert.equal(known.text, approvedAnswer.content, "Known answer must exactly equal approved Knowledge text.");
  assert.equal(known.data.answer?.blocks?.[0]?.value, approvedAnswer.content);
  assert.equal(known.metadata.citations?.[0]?.sourceId, approvedAnswer.chunkId);
  assert.equal(known.metadata.citations?.[0]?.revision, approvedAnswer.attributes.revision);
  assert.ok((known.metadata.citations ?? []).length > 0, "Known support answer must cite approved Knowledge.");
  assert.ok(
    (known.metadata.citations ?? []).every((citation) => typeof citation.revision === "string" && citation.revision.length > 0),
    "Every known support citation must identify its approved Knowledge revision.",
  );

  const unknown = a2aResult(await client.project(
    project.id,
    `/expert-agents/${encodeURIComponent(controlledAgentId)}/invoke`,
    { method: "POST", body: JSON.stringify({ text: unknownQuestion }) },
  ));
  assert.ok(
    ["UNKNOWN", "NEED_MORE_INFORMATION", "ESCALATED"].includes(unknown.metadata.outcome),
    `Unknown question produced unsafe outcome ${unknown.metadata.outcome}.`,
  );
  assert.equal((unknown.metadata.citations ?? []).length, 0, "Unknown/escalated output must not cite a fabricated source.");

  const ambiguous = a2aResult(await client.project(
    project.id,
    `/expert-agents/${encodeURIComponent(controlledAgentId)}/invoke`,
    { method: "POST", body: JSON.stringify({ text: "I have a login billing problem." }) },
  ));
  assert.equal(ambiguous.metadata.outcome, "NEED_MORE_INFORMATION", "Conflicting intents must trigger clarification.");
  assert.equal(ambiguous.data.answer?.status, "CLARIFY");

  console.log(JSON.stringify({
    status: "passed",
    projectId: project.id,
    github: {
      agentId: githubAgentId,
      versionId: githubResponse.metadata.versionId,
      repository: `${owner}/${repo}`,
      since: githubResponse.data.since,
      until: githubResponse.data.until,
      commitCount: oracle.length,
      independentlyVerified: true,
      hermesRegistryDiscovered: true,
    },
    controlledCustomerSupport: {
      agentId: controlledAgentId,
      versionId: known.metadata.versionId,
      knownOutcome: known.metadata.outcome,
      exactApprovedKnowledge: true,
      citationRevision: known.metadata.citations?.[0]?.revision,
      ambiguousOutcome: ambiguous.metadata.outcome,
      unknownOutcome: unknown.metadata.outcome,
      requestTimeModelBinding: false,
      hermesRegistryDiscovered: true,
    },
  }, null, 2));
}

main().catch((error) => {
  const blocked = error instanceof BlockedError;
  console.error(`${blocked ? "BLOCKED" : "FAILED"}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = blocked ? 2 : 1;
});
