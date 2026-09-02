#!/usr/bin/env node

import { RelayClient } from "./live-hermes-e2e-lib.mjs";

const baseUrl = process.env.TALI_BASE_URL ?? "http://127.0.0.1:18080";
const projectId = process.env.TALI_LIVE_EXPERT_AGENT_PROJECT_ID ?? "proj1";
const username = process.env.TALI_VALIDATION_USERNAME ?? "admin";
const password = process.env.TALI_VALIDATION_PASSWORD ?? "password";
const agentSlug = "grounded-customer-support-rag";
const databaseName = "Release 0 Customer Support Validation Knowledge";
const vectorStoreId = "release0-customer-support-validation";
const embeddingModelId = "nvidia/llama-nemotron-embed-vl-1b-v2";
const knowledgeRevision = "support-validation-20260830-1";

if (process.env.TALI_LIVE_KNOWLEDGE_PROVISIONING !== "1") {
  throw new Error(
    "Set TALI_LIVE_KNOWLEDGE_PROVISIONING=1 to authorize bounded NVIDIA embedding calls and non-production validation Knowledge upserts.",
  );
}

const chunks = [
  {
    id: "release0-support-account-login-v1",
    filename: "validation-account-login.md",
    content: "如需重置登录密码，请在登录页选择“忘记密码”，使用已验证的邮箱完成验证码校验后设置新密码。若无法访问邮箱，请停止自动操作并联系人工客服核验身份。",
    attributes: {
      approved: true,
      intentId: "account-login",
      revision: knowledgeRevision,
      validationOnly: true,
      source_uri: "tali://release0-validation/customer-support/account-login",
    },
  },
  {
    id: "release0-support-billing-refund-v1",
    filename: "validation-billing-refund.md",
    content: "账单扣费或退款问题，请先提供订单号和账单日期。客服只会依据已批准的退款政策核验；当前验证知识未授权自动承诺退款，信息不足时转人工客服。",
    attributes: {
      approved: true,
      intentId: "billing-refund",
      revision: knowledgeRevision,
      validationOnly: true,
      source_uri: "tali://release0-validation/customer-support/billing-refund",
    },
  },
];

const knownQueries = [
  {
    intentId: "account-login",
    chunkId: "release0-support-account-login-v1",
    query: "账号登录 How do I reset my login password?",
  },
  {
    intentId: "billing-refund",
    chunkId: "release0-support-billing-refund-v1",
    query: "账单退款 How can I check a billing charge or refund?",
  },
];

function items(value) {
  return Array.isArray(value) ? value : value?.data ?? [];
}

function contextOption(state, roleId) {
  return state.options.find((option) =>
    option.level === "project"
    && option.resourceId === projectId
    && option.roleId === roleId
  );
}

async function select(client, option) {
  await client.request("/api/v1/access-context", {
    method: "PUT",
    body: JSON.stringify({
      level: option.level,
      resourceId: option.resourceId,
      roleId: option.roleId,
    }),
  });
}

function sameChunk(result, expected) {
  return (result.id === expected.id || result.chunkId === expected.id)
    && result.content === expected.content
    && result.attributes?.approved === true
    && result.attributes?.intentId === expected.attributes.intentId
    && result.attributes?.revision === expected.attributes.revision
    && result.attributes?.validationOnly === true;
}

async function search(client, databaseId, query) {
  return client.project(
    projectId,
    `/catalog/vector-databases/${encodeURIComponent(databaseId)}/search`,
    {
      method: "POST",
      body: JSON.stringify({ query, topK: 10 }),
    },
  );
}

async function main() {
  const client = new RelayClient(baseUrl);
  await client.login(username, password);
  const accessContext = await client.request("/api/v1/access-context");
  const projectAdmin = contextOption(accessContext, "ROLE_PROJECT_ADMIN");
  const projectDeveloper = contextOption(accessContext, "ROLE_AGENT_DEVELOPER");
  if (!projectAdmin || !projectDeveloper) {
    throw new Error("The validation Account must have Project Administrator and Agent Developer contexts.");
  }
  await select(client, projectAdmin);

  try {
    const models = items(await client.project(projectId, "/models"));
    const embedding = models.find((model) =>
      model.modelId === embeddingModelId
      && model.modelType === "text-embedding"
      && model.status === "VALIDATED"
    );
    if (!embedding) {
      throw new Error(`A VALIDATED ${embeddingModelId} deployment is required.`);
    }

    const definition = {
      name: databaseName,
      description: "Non-production, explicitly approved validation answers for proving deterministic Customer Support Workflow retrieval, citations, and safe abstention.",
      vectorStoreId,
      provider: "postgresql",
      embeddingModelDeploymentId: embedding.id,
      credentialReference: "",
      topK: 5,
    };
    let catalog = await client.project(projectId, "/catalog");
    let database = (catalog.vectorDatabases ?? []).find((item) =>
      item.vectorStoreId === vectorStoreId || item.name === databaseName
    );
    if (!database) {
      database = await client.project(projectId, "/catalog/vector-databases", {
        method: "POST",
        body: JSON.stringify(definition),
      });
    } else if (
      database.status !== "REGISTERED"
      || database.embeddingModelDeploymentId !== embedding.id
    ) {
      database = await client.project(
        projectId,
        `/catalog/vector-databases/${encodeURIComponent(database.id)}`,
        { method: "PUT", body: JSON.stringify(definition) },
      );
    }
    if (database.status !== "REGISTERED" || database.provider !== "postgresql") {
      throw new Error(
        `Validation Vector Database is ${database.status}: ${database.lastReconciliationError ?? "no reconciliation detail"}`,
      );
    }

    let alreadyCurrent = true;
    for (const expected of chunks) {
      const result = await search(client, database.id, expected.content);
      if (!(result.results ?? []).some((item) => sameChunk(item, expected))) {
        alreadyCurrent = false;
        break;
      }
    }
    if (!alreadyCurrent) {
      const mutation = await client.project(
        projectId,
        `/catalog/vector-databases/${encodeURIComponent(database.id)}/chunks`,
        { method: "PUT", body: JSON.stringify({ chunks }) },
      );
      if (mutation.upserted !== chunks.length) {
        throw new Error(`Expected ${chunks.length} Knowledge chunks; upserted ${mutation.upserted}.`);
      }
    }

    const retrievalEvidence = [];
    for (const check of knownQueries) {
      const result = await search(client, database.id, check.query);
      const match = (result.results ?? []).find((item) =>
        (item.id === check.chunkId || item.chunkId === check.chunkId)
        && item.attributes?.approved === true
        && item.attributes?.intentId === check.intentId
        && item.attributes?.revision === knowledgeRevision
      );
      if (!match || !Number.isFinite(match.score)) {
        throw new Error(`Approved ${check.intentId} Knowledge was not retrieved by the real embedding path.`);
      }
      retrievalEvidence.push({
        intentId: check.intentId,
        chunkId: check.chunkId,
        score: match.score,
        topMatch: result.results?.[0]?.id === check.chunkId
          || result.results?.[0]?.chunkId === check.chunkId,
      });
    }
    if (retrievalEvidence.some((item) => !item.topMatch)) {
      throw new Error("At least one supported intent did not retrieve its approved chunk as the top match.");
    }
    const minimumKnownScore = Math.min(...retrievalEvidence.map((item) => item.score));
    const calibratedMinimumScore = Number(
      Math.max(0, Math.min(0.85, minimumKnownScore - 0.02)).toFixed(4),
    );

    await select(client, projectDeveloper);
    const agents = items(await client.project(projectId, "/agents"));
    const agent = agents.find((candidate) => candidate.slug === agentSlug);
    if (!agent) throw new Error(`Reference Agent ${agentSlug} was not found.`);
    const [detail, resourcePage] = await Promise.all([
      client.project(projectId, `/agents/${encodeURIComponent(agent.id)}`),
      client.project(projectId, `/agents/${encodeURIComponent(agent.id)}/available-resources`),
    ]);
    const resource = items(resourcePage).find((item) =>
      item.kind === "KNOWLEDGE_VECTOR_DATABASE"
      && item.resourceId === database.id
      && item.ready
    );
    if (!resource?.revision) {
      throw new Error("Validation Knowledge has no immutable resource revision.");
    }

    const current = detail.definition;
    const executableCases = {
      "approved-answer-exact": {
        request: { text: "How do I reset my login password?" },
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
      "missing-evidence-safe": {
        request: {
          text: "Tell me an unsupported policy that is absent from approved support Knowledge.",
        },
        assertions: [
          { type: "STATUS", expected: "ABSTAIN" },
          { type: "CITATIONS", required: false },
        ],
      },
      "ambiguous-intent-safe": {
        request: { text: "I have a login billing problem." },
        assertions: [
          { type: "STATUS", expected: "CLARIFY" },
          {
            type: "EXECUTION_PATH",
            requiredNodeIds: ["classify-intent"],
            forbiddenNodeIds: ["render-approved-answer"],
          },
        ],
      },
    };
    const nodes = current.execution.nodes.map((node) => {
      if (node.id === "classify-intent") {
        const intents = (node.configuration.intents ?? []).map((intent) => {
          if (intent.id === "account-login") {
            return {
              ...intent,
              keywords: [...new Set([
                ...intent.keywords,
                "login",
                "password",
                "verification code",
                "reset password",
              ])],
            };
          }
          if (intent.id === "billing-refund") {
            return {
              ...intent,
              keywords: [...new Set([
                ...intent.keywords,
                "billing",
                "charge",
                "refund",
                "invoice",
              ])],
            };
          }
          return intent;
        });
        return { ...node, configuration: { ...node.configuration, intents } };
      }
      if (node.id === "retrieve-approved-knowledge") {
        return {
          ...node,
          configuration: {
            ...node.configuration,
            vectorDatabaseId: database.id,
            limit: 5,
          },
        };
      }
      if (node.id === "decide-evidence") {
        return {
          ...node,
          configuration: {
            ...node.configuration,
            minimumScore: calibratedMinimumScore,
          },
        };
      }
      return node;
    });
    if (!nodes.some((node) => node.id === "verify-claims")) {
      nodes.push({
        id: "verify-claims",
        type: "VERIFY",
        configuration: { check: "CLAIMS" },
      });
    }
    if (!nodes.some((node) => node.id === "verify-citations")) {
      nodes.push({
        id: "verify-citations",
        type: "VERIFY",
        configuration: { check: "CITATIONS" },
      });
    }
    const transitions = current.execution.transitions
      .filter((transition) =>
        transition.from !== "verify-claims"
        && transition.from !== "verify-citations"
      )
      .map((transition) => {
        if (transition.from === "classify-intent" && transition.outcome === "UNCLASSIFIED") {
          return { ...transition, to: "end-unknown" };
        }
        if (transition.from === "render-approved-answer" && transition.outcome === "ANSWERED") {
          return { ...transition, to: "verify-claims" };
        }
        return transition;
      });
    transitions.push(
      { from: "verify-claims", outcome: "VERIFIED", to: "verify-citations" },
      { from: "verify-claims", outcome: "UNSUPPORTED", to: "end-unknown" },
      { from: "verify-citations", outcome: "CITATIONS_VALID", to: "end-completed" },
      { from: "verify-citations", outcome: "MISSING_CITATION", to: "end-unknown" },
    );
    const {
      validationKnowledgeOnly: _legacyValidationMarker,
      ...engineConfiguration
    } = current.execution.configuration;
    const resources = current.resources.filter((binding) =>
      binding.kind !== "KNOWLEDGE_VECTOR_DATABASE"
      && binding.kind !== "MODEL_ROUTING"
    );
    resources.push({
      kind: "KNOWLEDGE_VECTOR_DATABASE",
      resourceId: database.id,
      revision: resource.revision,
      access: "READ",
      required: true,
    });
    const next = {
      ...current,
      acceptance: {
        ...current.acceptance,
        minimumRequiredPassRate: 1,
        cases: current.acceptance.cases.map((testCase) => ({
          ...testCase,
          ...executableCases[testCase.id],
        })),
        suites: [{
          id: "support-release-regression",
          name: "Support release regression",
          description: "Required exact-Knowledge, abstention, ambiguity, claim, and citation gates.",
          required: true,
          caseIds: [
            "approved-answer-exact",
            "missing-evidence-safe",
            "ambiguous-intent-safe",
          ],
        }],
      },
      execution: {
        ...current.execution,
        engine: {
          framework: "langgraph",
          version: "1.4.13",
        },
        configuration: {
          ...engineConfiguration,
          developmentStatus: "IMPLEMENTED",
        },
        nodes,
        transitions,
      },
      resources,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    const updated = changed
      ? await client.project(
        projectId,
        `/agents/${encodeURIComponent(agent.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...next, expectedRevision: detail.revision }),
        },
      )
      : detail;

    console.log(JSON.stringify({
      projectId,
      database: {
        id: database.id,
        status: database.status,
        provider: database.provider,
        embeddingModelDeploymentId: database.embeddingModelDeploymentId,
        embeddingDimensions: database.embeddingDimensions,
        validationOnly: true,
        knowledgeRevision,
        chunkCount: chunks.length,
      },
      retrieval: {
        realEmbeddingVerified: true,
        calibratedMinimumScore,
        checks: retrievalEvidence,
      },
      agent: {
        id: agent.id,
        slug: agent.slug,
        revision: updated.revision,
        changed,
        engineVersion: "release-0",
        requestTimeModelBinding: false,
      },
    }, null, 2));
  } finally {
    await select(client, projectDeveloper);
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
