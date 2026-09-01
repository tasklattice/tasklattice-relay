#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { RelayClient } from "./live-hermes-e2e-lib.mjs";

export const githubAgentDefinition = {
  expectedRevision: 0,
  product: {
    name: "GitHub Activity Summary",
    purpose: "Summarize one GitHub ID's daily or weekly commit activity from an allowed repository, keeping exact commit facts while allowing approximate narrative themes.",
    targetUsers: ["Engineering leads", "Release owners"],
    capabilities: [
      "Accept a GitHub ID and a DAY or WEEK period",
      "Count that GitHub ID's commits over the selected period",
      "Summarize themes and risks from normalized commit facts",
      "Return commit-level citations and immutable Version metadata",
    ],
    outOfScope: [
      "Writing to GitHub or changing repository state",
      "Inventing commits, authors, dates, risks, or SHAs",
      "Reading repositories outside the bound GitHub MCP connection",
    ],
    inputContract: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 1 },
        githubId: { type: "string", minLength: 1 },
        period: { enum: ["DAY", "WEEK"] },
        repository: { type: "string", pattern: "^[^/]+/[^/]+$" },
        since: { type: "string" },
        until: { type: "string" },
        branch: { type: ["string", "null"] },
        grouping: { enum: ["NONE", "DAY", "WEEK", "AUTHOR"] },
      },
      required: ["text", "githubId", "period"],
      additionalProperties: false,
    },
    outputContract: {
      type: "object",
      properties: {
        outcome: { type: "string" },
        text: { type: "string" },
        citations: { type: "array" },
        data: { type: "object" },
      },
      required: ["outcome", "text", "citations"],
      additionalProperties: true,
    },
  },
  policy: {
    preset: "FLEXIBLE",
    groundingPolicy: "TOOL_GROUNDED",
    outputMode: "STRUCTURED",
    actionPolicy: "ALLOWLIST",
  },
  delegations: [],
  acceptance: {
    minimumRequiredPassRate: 1,
    cases: [
      {
        id: "count-matches-github",
        title: "Commit count matches the GitHub oracle",
        kind: "HAPPY_PATH",
        given: "A reachable repository with commits from the requested GitHub ID and verified time range",
        when: "The Agent is asked for the weekly commit summary",
        then: [
          "The count equals an independent GitHub REST query for the same time window",
          "The returned SHA set exactly matches the normalized GitHub result",
        ],
        required: true,
        request: {
          text: "Summarize repository activity for the selected range.",
          githubId: "Sn0rt",
          period: "WEEK",
          since: "2026-08-28T00:00:00.000Z",
          until: "2026-08-30T00:00:00.000Z",
        },
        assertions: [
          { type: "STATUS", expected: "ANSWER" },
          { type: "TOOL_INVOCATION", toolName: "list_commits", minimumCalls: 1 },
          { type: "CITATIONS", required: true },
        ],
      },
      {
        id: "summary-is-grounded",
        title: "Every generated theme is grounded",
        kind: "EDGE_CASE",
        given: "Normalized commit facts are available",
        when: "The model groups themes or identifies risks",
        then: [
          "Every theme and risk references only SHAs in the normalized fact set",
          "Invalid model output falls back to deterministic commit facts",
        ],
        required: true,
        request: {
          text: "Summarize the important changes and risks from this GitHub activity.",
          githubId: "Sn0rt",
          period: "WEEK",
          since: "2026-08-28T00:00:00.000Z",
          until: "2026-08-30T00:00:00.000Z",
        },
        assertions: [
          { type: "STATUS", expected: "ANSWER" },
          { type: "CITATIONS", required: true },
        ],
      },
      {
        id: "empty-week",
        title: "An empty week remains factual",
        kind: "FAILURE_PATH",
        given: "The repository has no commits in the current week",
        when: "The Agent is invoked",
        then: ["It reports zero commits without generating unsupported activity"],
        required: true,
        request: {
          text: "Summarize this verified empty range.",
          githubId: "guohao",
          period: "DAY",
          since: "2000-01-01T00:00:00.000Z",
          until: "2000-01-01T00:00:01.000Z",
        },
        assertions: [
          { type: "STATUS", expected: "ANSWER" },
          { type: "CITATIONS", required: false },
        ],
      },
    ],
    suites: [{
      id: "github-publish-regression",
      name: "GitHub publish regression",
      description: "Required tool grounding, semantic coverage, and empty-result behavior.",
      required: true,
      caseIds: ["count-matches-github", "summary-is-grounded", "empty-week"],
    }],
  },
  safety: {
    guardrails: [
      {
        id: "github-read-only",
        category: "TOOL_USE",
        rule: "Only call the read-only list_commits tool on the bound GitHub MCP connection.",
        violationBehavior: "REJECT",
        required: true,
      },
      {
        id: "commit-grounding",
        category: "GROUNDING",
        rule: "Counts, SHAs, authors, dates, themes, and risks must be grounded in normalized commit evidence.",
        violationBehavior: "UNKNOWN",
        required: true,
      },
    ],
    prohibitedBehaviors: [
      "Mutating GitHub state",
      "Citing a commit outside the current query result",
      "Reporting generated prose as verified repository fact",
    ],
    noEvidenceBehavior: "UNKNOWN",
    allowGeneralModelFallback: false,
  },
  execution: {
    mode: "AGENTIC",
    engine: { framework: "langgraph", version: "1.4.13" },
    modelRoutingId: "unassigned-model-routing",
    instruction: "Use a read-only GitHub MCP tool to collect facts. Let the Project Model Routing summarize only the normalized facts, validate every cited SHA, and retain deterministic output when generation is invalid.",
    configuration: {
      engineType: "GITHUB_WEEKLY_COMMIT_SUMMARIZER",
      developmentStatus: "DESIGN",
      owner: "tasklattice",
      repo: "tasklattice-relay",
      branch: null,
      timeZone: "Asia/Shanghai",
      githubMcpServerId: "unassigned-github-mcp",
      allowedRepositories: [],
      locale: "zh-CN",
      requiredProjectResources: ["READ_ONLY_GITHUB_MCP", "MODEL_ROUTING"],
    },
    maxSteps: 8,
    timeoutMs: 120000,
  },
  resources: [],
};

export const groundedSupportAgentDefinition = {
  expectedRevision: 0,
  product: {
    name: "Grounded Customer Support RAG",
    purpose: "Answer supported customer questions using exact approved Knowledge revisions, and return UNKNOWN or escalate whenever evidence is missing or ambiguous.",
    targetUsers: ["Customers", "Customer support operators", "Hermes supervisors"],
    capabilities: [
      "Classify supported customer intents through explicit Workflow rules",
      "Retrieve approved revisioned support knowledge",
      "Return the exact approved answer with citations or a safe fallback",
    ],
    outOfScope: [
      "Generating factual support prose with a request-time model",
      "Answering unsupported product or account questions",
      "Changing customer accounts or transactional state",
    ],
    inputContract: {
      type: "object",
      properties: { text: { type: "string", minLength: 1 } },
      required: ["text"],
      additionalProperties: false,
    },
    outputContract: {
      type: "object",
      properties: {
        outcome: { type: "string" },
        text: { type: "string" },
        citations: { type: "array" },
        data: { type: "object" },
      },
      required: ["outcome", "text", "citations"],
      additionalProperties: true,
    },
  },
  policy: {
    preset: "CONTROLLED",
    groundingPolicy: "REQUIRED",
    outputMode: "STRUCTURED",
    actionPolicy: "ALLOWLIST",
  },
  acceptance: {
    minimumRequiredPassRate: 1,
    cases: [
      {
        id: "approved-answer-exact",
        title: "Supported intent returns exact approved text",
        kind: "HAPPY_PATH",
        given: "One approved Knowledge revision covers the classified intent",
        when: "A customer asks a supported question",
        then: [
          "The response text exactly equals the approved Knowledge chunk",
          "The response cites the source and Knowledge revision",
        ],
        required: true,
        request: { text: "我忘记登录密码，如何重置密码？" },
        assertions: [
          { type: "STATUS", expected: "ANSWER" },
          { type: "CITATIONS", required: true },
          {
            type: "EXECUTION_PATH",
            requiredNodeIds: ["retrieve-approved-knowledge", "verify-claims", "verify-citations"],
            forbiddenNodeIds: [],
          },
        ],
      },
      {
        id: "missing-evidence-safe",
        title: "Missing evidence never becomes an answer",
        kind: "FAILURE_PATH",
        given: "No approved Knowledge meets the evidence threshold",
        when: "The Workflow reaches its decision node",
        then: ["The outcome is UNKNOWN or ESCALATED and contains no fabricated citation"],
        required: true,
        request: { text: "登录时如何更换账号绑定的硬件安全密钥？" },
        assertions: [
          { type: "STATUS", expected: "ABSTAIN" },
          { type: "CITATIONS", required: false },
        ],
      },
      {
        id: "ambiguous-intent-safe",
        title: "Ambiguous intent requests clarification",
        kind: "EDGE_CASE",
        given: "Multiple intent rules match with equal confidence",
        when: "The classifier evaluates the message",
        then: ["The Workflow returns NEED_MORE_INFORMATION without retrieving an unrelated answer"],
        required: true,
        request: { text: "我有登录和账单问题。" },
        assertions: [
          { type: "STATUS", expected: "CLARIFY" },
          { type: "EXECUTION_PATH", requiredNodeIds: ["classify-intent"], forbiddenNodeIds: ["render-approved-answer"] },
        ],
      },
    ],
    suites: [{
      id: "support-publish-regression",
      name: "Support publish regression",
      description: "Required exact-Knowledge, abstention, ambiguity, claim, and citation gates.",
      required: true,
      caseIds: ["approved-answer-exact", "missing-evidence-safe", "ambiguous-intent-safe"],
    }],
  },
  safety: {
    guardrails: [
      {
        id: "approved-knowledge-only",
        category: "GROUNDING",
        rule: "Factual support answers must exactly match approved, revisioned Knowledge for the classified intent.",
        violationBehavior: "UNKNOWN",
        required: true,
      },
      {
        id: "explicit-flow-only",
        category: "OPERATIONAL",
        rule: "Every non-terminal node and outcome must follow one declared Workflow transition.",
        violationBehavior: "ESCALATE",
        required: true,
      },
    ],
    prohibitedBehaviors: [
      "Using a request-time model to compose factual support answers",
      "Answering from model memory",
      "Hiding missing, conflicting, or stale evidence",
    ],
    noEvidenceBehavior: "UNKNOWN",
    allowGeneralModelFallback: false,
  },
  execution: {
    mode: "WORKFLOW",
    engine: { framework: "langgraph", version: "1.4.13" },
    entrypoint: "normalize-request",
    configuration: {
      engineType: "DETERMINISTIC_CUSTOMER_SUPPORT",
      developmentStatus: "DESIGN",
      unknownMessage: "我暂时无法从已批准的客服知识中确认答案，请补充信息或联系人工客服。",
      escalationMessage: "这个问题需要人工客服继续处理，我已停止自动回答。",
      requiredProjectResources: ["POSTGRESQL_VECTOR_DATABASE"],
    },
    nodes: [
      { id: "normalize-request", type: "TRANSFORM", configuration: {} },
      {
        id: "classify-intent",
        type: "REASON",
        configuration: {
          intents: [
            { id: "account-login", label: "账号登录", keywords: ["登录", "密码", "验证码", "无法进入"] },
            { id: "billing-refund", label: "账单退款", keywords: ["账单", "扣费", "退款", "发票"] },
          ],
        },
      },
      {
        id: "retrieve-approved-knowledge",
        type: "KNOWLEDGE",
        configuration: { vectorDatabaseId: "unassigned-support-knowledge", limit: 5 },
      },
      {
        id: "decide-evidence",
        type: "DECISION",
        configuration: { minimumScore: 0.5, minimumScoreDelta: 0.05, noEvidenceOutcome: "UNKNOWN" },
      },
      { id: "render-approved-answer", type: "RESPONSE", configuration: {} },
      { id: "verify-claims", type: "VERIFY", configuration: { check: "CLAIMS" } },
      { id: "verify-citations", type: "VERIFY", configuration: { check: "CITATIONS" } },
      { id: "escalate-human", type: "ESCALATE", configuration: {} },
      { id: "end-completed", type: "END", configuration: { outcome: "COMPLETED" } },
      { id: "end-unknown", type: "END", configuration: { outcome: "UNKNOWN" } },
      { id: "end-escalated", type: "END", configuration: { outcome: "ESCALATED" } },
      { id: "end-more-information", type: "END", configuration: { outcome: "NEED_MORE_INFORMATION" } },
    ],
    transitions: [
      { from: "normalize-request", outcome: "NORMALIZED", to: "classify-intent" },
      { from: "normalize-request", outcome: "EMPTY", to: "end-more-information" },
      { from: "classify-intent", outcome: "CLASSIFIED", to: "retrieve-approved-knowledge" },
      { from: "classify-intent", outcome: "UNCLASSIFIED", to: "end-more-information" },
      { from: "classify-intent", outcome: "AMBIGUOUS", to: "end-more-information" },
      { from: "retrieve-approved-knowledge", outcome: "EVIDENCE_FOUND", to: "decide-evidence" },
      { from: "retrieve-approved-knowledge", outcome: "NO_EVIDENCE", to: "end-unknown" },
      { from: "retrieve-approved-knowledge", outcome: "NO_INTENT", to: "end-more-information" },
      { from: "decide-evidence", outcome: "ANSWER", to: "render-approved-answer" },
      { from: "decide-evidence", outcome: "UNKNOWN", to: "end-unknown" },
      { from: "decide-evidence", outcome: "ESCALATE", to: "escalate-human" },
      { from: "render-approved-answer", outcome: "ANSWERED", to: "verify-claims" },
      { from: "verify-claims", outcome: "VERIFIED", to: "verify-citations" },
      { from: "verify-claims", outcome: "UNSUPPORTED", to: "end-unknown" },
      { from: "verify-citations", outcome: "CITATIONS_VALID", to: "end-completed" },
      { from: "verify-citations", outcome: "MISSING_CITATION", to: "end-unknown" },
      { from: "escalate-human", outcome: "ESCALATED", to: "end-escalated" },
    ],
    timeoutMs: 30000,
  },
  resources: [],
};

const references = [
  {
    slug: "github-weekly-commit-summary",
    name: githubAgentDefinition.product.name,
    description: githubAgentDefinition.product.purpose,
    executionMode: "AGENTIC",
    definition: githubAgentDefinition,
  },
  {
    slug: "grounded-customer-support-rag",
    name: groundedSupportAgentDefinition.product.name,
    description: groundedSupportAgentDefinition.product.purpose,
    executionMode: "WORKFLOW",
    definition: groundedSupportAgentDefinition,
  },
];

async function main() {
  const baseUrl = process.env.TALI_BASE_URL ?? "http://localhost:38080";
  const username = process.env.TALI_VALIDATION_USERNAME ?? "admin";
  const password = process.env.TALI_VALIDATION_PASSWORD ?? "password";
  const client = new RelayClient(baseUrl);
  await client.login(username, password);
  const projects = await client.request("/api/v1/projects");
  const configuredProjectId = process.env.TALI_LIVE_EXPERT_AGENT_PROJECT_ID?.trim();
  const project = configuredProjectId
    ? projects.find((candidate) => candidate.id === configuredProjectId)
    : projects[0];
  if (!project) throw new Error(configuredProjectId ? `Project ${configuredProjectId} was not found.` : "No Project is available.");
  await client.request("/api/v1/access-context", {
    method: "PUT",
    body: JSON.stringify({
      level: "project",
      resourceId: project.id,
      roleId: "ROLE_AGENT_DEVELOPER",
    }),
  });
  const currentResponse = await client.project(project.id, "/agents");
  const current = Array.isArray(currentResponse) ? currentResponse : currentResponse?.data ?? [];
  const results = [];
  for (const reference of references) {
    let agent = current.find((candidate) => candidate.slug === reference.slug);
    if (!agent) {
      agent = await client.project(project.id, "/agents", {
        method: "POST",
        body: JSON.stringify({
          slug: reference.slug,
          executionMode: reference.executionMode,
          definition: reference.definition,
        }),
      });
    }
    let detail = await client.project(project.id, `/agents/${encodeURIComponent(agent.id)}`);
    const availablePage = await client.project(project.id, `/agents/${encodeURIComponent(agent.id)}/available-resources`);
    const available = Array.isArray(availablePage) ? availablePage : availablePage?.data ?? [];
    const ready = (kind, preferred) => available.find((resource) =>
      resource.kind === kind && resource.ready && resource.revision && preferred.test(resource.name)
    ) ?? available.find((resource) => resource.kind === kind && resource.ready && resource.revision);
    const desired = structuredClone(reference.definition);
    desired.expectedRevision = detail.revision;
    if (reference.executionMode === "AGENTIC") {
      const mcp = ready("MCP_SERVER", /^github read-only commits$/i) ?? ready("MCP_SERVER", /github/i);
      const routing = ready("MODEL_ROUTING", /expert|default|deepseek/i);
      if (!mcp || !routing) throw new Error("GitHub Activity Summary requires one healthy GitHub MCP Server and one READY Model Routing.");
      desired.execution = {
        ...desired.execution,
        modelRoutingId: routing.resourceId,
        configuration: {
          ...desired.execution.configuration,
          developmentStatus: "IMPLEMENTED",
          githubMcpServerId: mcp.resourceId,
        },
      };
      desired.resources = [
        { kind: "MCP_SERVER", resourceId: mcp.resourceId, revision: mcp.revision, access: "READ", required: true },
        { kind: "MODEL_ROUTING", resourceId: routing.resourceId, revision: routing.revision, access: "INVOKE", required: true },
      ];
    } else {
      const knowledge = ready("KNOWLEDGE_VECTOR_DATABASE", /support|customer|validation/i);
      if (!knowledge) throw new Error("Grounded Customer Support RAG requires one READY PostgreSQL Knowledge Vector Database.");
      desired.execution = {
        ...desired.execution,
        configuration: { ...desired.execution.configuration, developmentStatus: "IMPLEMENTED" },
        nodes: desired.execution.nodes.map((node) => node.id === "retrieve-approved-knowledge"
          ? { ...node, configuration: { ...node.configuration, vectorDatabaseId: knowledge.resourceId } }
          : node),
      };
      desired.resources = [{
        kind: "KNOWLEDGE_VECTOR_DATABASE",
        resourceId: knowledge.resourceId,
        revision: knowledge.revision,
        access: "READ",
        required: true,
      }];
    }
    if (JSON.stringify(desired) !== JSON.stringify(detail.definition)) {
      await client.project(project.id, `/agents/${encodeURIComponent(agent.id)}`, {
        method: "PATCH",
        body: JSON.stringify(desired),
      });
      detail = await client.project(project.id, `/agents/${encodeURIComponent(agent.id)}`);
    }
    const currentTest = detail.testRuns.find((run) => run.contentDigest === detail.contentDigest && run.status === "PASSED");
    if (!currentTest) {
      await client.project(project.id, `/agents/${encodeURIComponent(agent.id)}/test-runs`, {
        method: "POST",
        body: "{}",
      });
      detail = await client.project(project.id, `/agents/${encodeURIComponent(agent.id)}`);
    }
    if (detail.latestVersion?.contentDigest !== detail.contentDigest) {
      await client.project(project.id, `/agents/${encodeURIComponent(agent.id)}/publications`, {
        method: "POST",
        body: JSON.stringify({
          expectedRevision: detail.revision,
          publicationNotes: "Restored reference Agent with executable framework artifacts and verified A2A contract.",
        }),
      });
      detail = await client.project(project.id, `/agents/${encodeURIComponent(agent.id)}`);
    }
    results.push({
      slug: reference.slug,
      agentId: agent.id,
      versionId: detail.latestVersion?.id,
      lifecycleState: detail.lifecycleState,
    });
  }

  let garden = await client.project(project.id, "/agent-garden");
  for (const result of results) {
    const gardenAgent = garden.agents.find((candidate) =>
      candidate.source === "PROJECT_DEVELOPED"
      && candidate.distribution?.type === "VERSION_BUNDLE"
      && candidate.distribution.agentId === result.agentId
    );
    if (!gardenAgent) throw new Error(`Published Agent ${result.slug} is missing from Agent Garden.`);
    let instance = garden.instances.find((candidate) =>
      candidate.agentId === result.agentId && candidate.versionId === result.versionId
    );
    if (!instance) {
      instance = await client.project(project.id, `/agent-garden/agents/${encodeURIComponent(gardenAgent.id)}/instances`, {
        method: "POST",
        body: JSON.stringify({ versionId: result.versionId }),
      });
      garden = await client.project(project.id, "/agent-garden");
    }
    if (instance.status !== "READY" || !instance.endpoint || !instance.agentCardUrl) {
      throw new Error(`${result.slug} Instance is ${instance.status}; A2A endpoint was not exposed.`);
    }
    result.instanceId = instance.id;
    result.instanceStatus = instance.status;
    result.a2aEndpoint = instance.endpoint;
    result.agentCardUrl = instance.agentCardUrl;
  }
  console.log(JSON.stringify({ projectId: project.id, references: results }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
