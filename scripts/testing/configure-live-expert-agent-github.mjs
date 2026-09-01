#!/usr/bin/env node

import { RelayClient } from "./live-hermes-e2e-lib.mjs";

const baseUrl = process.env.TALI_BASE_URL ?? "http://127.0.0.1:18080";
const projectId = process.env.TALI_LIVE_EXPERT_AGENT_PROJECT_ID ?? "proj1";
const username = process.env.TALI_VALIDATION_USERNAME ?? "admin";
const password = process.env.TALI_VALIDATION_PASSWORD ?? "password";
const serverName = "Release 0 Read-only GitHub";

if (process.env.TALI_LIVE_GITHUB_PROVISIONING !== "1") {
  throw new Error(
    "Set TALI_LIVE_GITHUB_PROVISIONING=1 to authorize one bounded, read-only local GitHub MCP validation resource.",
  );
}

function items(value) {
  return Array.isArray(value) ? value : value?.data ?? [];
}

function contextOption(state, projectId, roleId) {
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

async function main() {
  const client = new RelayClient(baseUrl);
  await client.login(username, password);
  const accessContext = await client.request("/api/v1/access-context");
  const projectAdmin = contextOption(accessContext, projectId, "ROLE_PROJECT_ADMIN");
  const projectDeveloper = contextOption(accessContext, projectId, "ROLE_AGENT_DEVELOPER");
  if (!projectAdmin || !projectDeveloper) {
    throw new Error("The validation Account must have Project Administrator and Agent Developer contexts.");
  }
  await select(client, projectAdmin);

  try {
    const connection = {
      name: serverName,
      alias: "release0_github_readonly",
      description: "Local release validation connection that reads real public GitHub commit metadata through one allowlisted tool.",
      category: "Developer Tools",
      sourceUrl: "https://github.com/tasklattice/tasklattice-relay",
      transport: "http",
      endpoint: "http://tali-relay-example-mcp:3000/mcp",
      args: [],
      environment: [],
      authType: "basic",
      authReference: "k8s://tali/tali-relay-example-mcp-auth#auth-value",
      accessGroups: [],
      allowedTools: ["list_commits"],
      readOnlyTools: ["list_commits"],
      extraHeaders: [],
      staticHeaders: [],
      internalNetworkOnly: true,
    };
    let catalog = await client.project(projectId, "/catalog");
    let server = (catalog.mcpServers ?? []).find((candidate) => candidate.name === serverName);
    if (!server) {
      server = await client.project(projectId, "/catalog/mcp-servers", {
        method: "POST",
        body: JSON.stringify(connection),
      });
    } else {
      // LiteLLM's MCP registry is runtime state. Re-register the exact Catalog
      // definition so this flow also heals a Gateway restart without widening
      // the immutable allowlist or read-only declaration.
      server = await client.project(
        projectId,
        `/catalog/mcp-servers/${encodeURIComponent(server.id)}`,
        { method: "PUT", body: JSON.stringify(connection) },
      );
    }
    const listCommits = server.tools.find((tool) => tool.name === "list_commits");
    const listCommitsReadOnly = listCommits?.annotations?.readOnlyHint === true
      || server.readOnlyTools?.includes("list_commits") === true;
    if (server.status !== "HEALTHY" || !listCommitsReadOnly) {
      throw new Error(
        `GitHub MCP is ${server.status}; a discovered read-only list_commits tool is required.`,
      );
    }

    await select(client, projectDeveloper);
    const agents = items(await client.project(projectId, "/expert-agents"));
    const agent = agents.find((candidate) => candidate.slug === "github-weekly-commit-summary");
    if (!agent) throw new Error("The GitHub Activity Summary reference Agent was not found.");
    const [workingCopy, resourcePage] = await Promise.all([
      client.project(projectId, `/expert-agents/${encodeURIComponent(agent.id)}/working-copy`),
      client.project(projectId, `/expert-agents/${encodeURIComponent(agent.id)}/available-resources`),
    ]);
    const resources = items(resourcePage);
    const mcpResource = resources.find((resource) =>
      resource.kind === "MCP_SERVER" && resource.resourceId === server.id && resource.ready
    );
    const routingResource = resources.find((resource) =>
      resource.kind === "MODEL_ROUTING" && resource.ready
    );
    if (!mcpResource?.revision || !routingResource?.revision) {
      throw new Error("The GitHub MCP or Project Model Routing has no immutable resource revision.");
    }
    const current = workingCopy.value;
    const nextResources = current.resources.filter((resource) =>
      resource.kind !== "MCP_SERVER" && resource.kind !== "MODEL_ROUTING"
    );
    nextResources.push(
      {
        kind: "MCP_SERVER",
        resourceId: mcpResource.resourceId,
        revision: mcpResource.revision,
        access: "INVOKE",
        required: true,
      },
      {
        kind: "MODEL_ROUTING",
        resourceId: routingResource.resourceId,
        revision: routingResource.revision,
        access: "INVOKE",
        required: true,
      },
    );
    const updated = await client.project(
      projectId,
      `/expert-agents/${encodeURIComponent(agent.id)}/working-copy`,
      {
        method: "PUT",
        body: JSON.stringify({
          ...current,
          expectedRevision: workingCopy.revision,
          execution: {
            ...current.execution,
            engine: {
              framework: "tasklattice-expert-runtime",
              version: "release-0",
            },
            modelRoutingId: routingResource.resourceId,
            configuration: {
              ...current.execution.configuration,
              developmentStatus: "IMPLEMENTED",
              owner: "tasklattice",
              repo: "tasklattice-relay",
              githubMcpServerId: server.id,
              allowedRepositories: ["tasklattice/tasklattice-relay"],
            },
          },
          resources: nextResources,
        }),
      },
    );

    console.log(JSON.stringify({
      projectId,
      mcp: {
        id: server.id,
        status: server.status,
        allowedTools: server.allowedTools,
        readOnlyListCommits: listCommitsReadOnly,
        internalNetworkOnly: server.internalNetworkOnly,
      },
      agent: {
        id: agent.id,
        slug: agent.slug,
        workingCopyRevision: updated.revision,
        engineVersion: "release-0",
        repository: "tasklattice/tasklattice-relay",
        modelRoutingId: routingResource.resourceId,
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
