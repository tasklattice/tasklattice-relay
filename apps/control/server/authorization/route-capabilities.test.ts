import { readdirSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  conditionalInstanceCreateRequirements,
  conditionalRequestRequirements,
  projectRouteAdmissionPolicy,
} from "./route-capabilities";

describe("Project route capability declarations", () => {
  it("fails closed when a new Project route has no CAP declaration", () => {
    const routeRoot = fileURLToPath(new URL(
      "../routes/api/v1/projects/[projectId]",
      import.meta.url,
    ));
    const files = readdirSync(routeRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => relative(routeRoot, `${entry.parentPath}/${entry.name}`));
    const uncovered: string[] = [];
    for (const file of files) {
      const methodMatch = file.match(/\.(get|post|put|patch|delete)\.ts$/);
      const method = methodMatch?.[1]?.toUpperCase() ?? "GET";
      const route = file
        .replace(/\.(?:get|post|put|patch|delete)?\.ts$/, "")
        .replace(/\.ts$/, "")
        .replace(/^index$|\/index$/, "")
        .replace(/\[kind\]/g, "skills")
        .replace(/\[[^\]]+\]/g, "test-object");
      const pathname = `/api/v1/projects/individual${route ? `/${route}` : ""}`;
      if (!projectRouteAdmissionPolicy(method, pathname)) uncovered.push(file);
    }
    // A stable sentinel proves the recursive scan is looking at the intended
    // tree. The uncovered assertion below is the actual fail-closed contract;
    // pinning the total made every correctly authorized new route fail CI.
    expect(files).toContain("instances/[instanceId]/interaction.get.ts");
    expect(uncovered).toEqual([]);
  });

  it("allows members to switch only among roles assigned to their Account", () => {
    expect(projectRouteAdmissionPolicy(
      "PUT",
      "/api/v1/projects/individual/role",
    )).toMatchObject({
      relation: "PROJECT",
      requirements: [{
        capability: "CAP_PROJECT_VIEW",
        resourceType: "ProjectRole",
      }],
    });
  });

  it("guards the historically membership-only high-risk endpoints", () => {
    expect(projectRouteAdmissionPolicy(
      "POST",
      "/api/v1/projects/individual/instances",
    )?.requirements).toContainEqual({
      capability: "CAP_AGENT_INSTANCE_CREATE",
      resourceType: "AgentInstance",
    });
    expect(projectRouteAdmissionPolicy(
      "DELETE",
      "/api/v1/projects/individual/instances/agent-1",
    )?.requirements[0]?.capability).toBe("CAP_AGENT_INSTANCE_DELETE");
    expect(projectRouteAdmissionPolicy(
      "POST",
      "/api/v1/projects/individual/instances/agent-1/terminal-sessions",
    )?.requirements[0]?.capability).toBe("CAP_AGENT_INSTANCE_TERMINAL_EXEC");
    expect(projectRouteAdmissionPolicy(
      "POST",
      "/api/v1/projects/individual/catalog/skills/skill-1/verify",
    )?.requirements[0]?.capability).toBe("CAP_SKILL_VERIFY");
    expect(projectRouteAdmissionPolicy(
      "PUT",
      "/api/v1/projects/individual/catalog/vector-databases/knowledge-1/chunks",
    )?.requirements[0]).toEqual({
      capability: "CAP_VECTOR_DATABASE_UPDATE",
      resourceType: "VectorChunk",
    });
    expect(projectRouteAdmissionPolicy(
      "DELETE",
      "/api/v1/projects/individual/catalog/vector-databases/knowledge-1/chunks/chunk-1",
    )?.requirements[0]?.capability).toBe("CAP_VECTOR_DATABASE_UPDATE");
    expect(projectRouteAdmissionPolicy(
      "POST",
      "/api/v1/projects/individual/catalog/vector-databases/knowledge-1/folders",
    )?.requirements[0]).toEqual({
      capability: "CAP_VECTOR_DATABASE_UPDATE",
      resourceType: "VectorFolder",
    });
    expect(projectRouteAdmissionPolicy(
      "PATCH",
      "/api/v1/projects/individual/catalog/vector-databases/knowledge-1/documents/file-1",
    )?.requirements[0]?.capability).toBe("CAP_VECTOR_DATABASE_UPDATE");
  });

  it("separates Durable Memory read, curation, export, and dangerous operations", () => {
    const cases = [
      ["GET", "/api/v1/projects/individual/memories", "CAP_AGENT_MEMORY_ITEM_VIEW"],
      ["GET", "/api/v1/projects/individual/memories/memory-1/facts", "CAP_AGENT_MEMORY_CONTENT_VIEW"],
      ["PATCH", "/api/v1/projects/individual/memories/memory-1/facts/fact-1", "CAP_AGENT_MEMORY_CONTENT_WRITE"],
      ["POST", "/api/v1/projects/individual/memories/memory-1/items/fact-1/invalidate", "CAP_AGENT_MEMORY_CONTENT_WRITE"],
      ["DELETE", "/api/v1/projects/individual/memories/memory-1/conversations/conversation-1", "CAP_AGENT_MEMORY_CONTENT_DELETE"],
      ["POST", "/api/v1/projects/individual/memories/memory-1/conversations/conversation-1/redact", "CAP_AGENT_MEMORY_CONTENT_WRITE"],
      ["POST", "/api/v1/projects/individual/memories/memory-1/exports", "CAP_AGENT_MEMORY_EXPORT"],
      ["DELETE", "/api/v1/projects/individual/memories/memory-1", "CAP_AGENT_MEMORY_CONTENT_PURGE"],
      ["POST", "/api/v1/projects/individual/memories/memory-1/outbox/outbox-1/replay", "CAP_AGENT_MEMORY_INDEX_REBUILD"],
    ] as const;
    for (const [method, pathname, capability] of cases) {
      const expected = {
        relation: "PROJECT",
        requirements: [{ capability, resourceType: "DurableMemory" }],
        ...(pathname.includes("/memory-1") ? { resourceId: "memory-1" } : {}),
      };
      expect(projectRouteAdmissionPolicy(method, pathname)).toMatchObject(expected);
    }
  });

  it("preserves conditional route semantics with a trailing slash", () => {
    const instancePolicy = projectRouteAdmissionPolicy(
      "POST",
      "/api/v1/projects/individual/instances/",
    )!;
    expect(instancePolicy).toMatchObject({ kind: "INSTANCE_CREATE" });
    expect(conditionalRequestRequirements(
      instancePolicy,
      new URL("http://tali.test/api/v1/projects/individual/instances/"),
      { agentPlatform: "openclaw" },
    ).map(({ capability }) => capability)).toContain(
      "CAP_AGENT_MEMORY_CONFIG_UPDATE",
    );
    const auditPolicy = projectRouteAdmissionPolicy(
      "GET",
      "/api/v1/projects/individual/audit-logs/",
    )!;
    expect(auditPolicy).toMatchObject({ kind: "AUDIT_LOG_LIST" });
    expect(conditionalRequestRequirements(
      auditPolicy,
      new URL("http://tali.test/api/v1/projects/individual/audit-logs/?include_sensitive=true"),
    )).toContainEqual({
      capability: "CAP_AUDIT_SENSITIVE_CONTENT_VIEW",
      resourceType: "AuditLog",
    });
  });

  it("treats raw Instance sandbox audit as sensitive content", () => {
    expect(projectRouteAdmissionPolicy(
      "GET",
      "/api/v1/projects/individual/instances/agent-1/audit",
    )?.requirements).toEqual([
      {
        capability: "CAP_AUDIT_DETAIL_VIEW",
        resourceType: "AgentInstance",
      },
      {
        capability: "CAP_AUDIT_SENSITIVE_CONTENT_VIEW",
        resourceType: "AgentInstanceAudit",
      },
    ]);
  });

  it("separates interaction credentials from Instance configuration", () => {
    expect(projectRouteAdmissionPolicy(
      "GET",
      "/api/v1/projects/individual/instances/agent-1/interaction",
    )).toMatchObject({
      relation: "INSTANCE",
      resourceId: "agent-1",
      requirements: [{
        capability: "CAP_AGENT_INSTANCE_INTERACT",
        resourceType: "AgentInstance",
      }],
    });
  });

  it("separates runtime logs from Instance configuration", () => {
    expect(projectRouteAdmissionPolicy(
      "GET",
      "/api/v1/projects/individual/instances/agent-1/logs",
    )?.requirements).toEqual([{
      capability: "CAP_AGENT_INSTANCE_LOG_VIEW",
      resourceType: "AgentInstance",
    }]);
    expect(projectRouteAdmissionPolicy(
      "POST",
      "/api/v1/projects/individual/instances/agent-1/log-sessions",
    )?.requirements).toEqual([{
      capability: "CAP_AGENT_INSTANCE_LOG_VIEW",
      resourceType: "AgentInstance",
    }]);
  });

  it("requires every underlying read capability for the Project overview", () => {
    expect(projectRouteAdmissionPolicy(
      "GET",
      "/api/v1/projects/individual/overview",
    )?.requirements.map(({ capability }) => capability)).toEqual([
      "CAP_USAGE_VIEW",
      "CAP_COST_VIEW",
      "CAP_PROJECT_QUOTA_VIEW",
      "CAP_AGENT_INSTANCE_CONFIG_VIEW",
      "CAP_AGENT_MEMORY_CONFIG_VIEW",
      "CAP_SKILL_VIEW",
      "CAP_ACCESS_POLICY_VIEW",
    ]);
  });

  it("adds every side-effecting binding implied by Instance creation", () => {
    expect(conditionalInstanceCreateRequirements({
      agentPlatform: "openclaw",
      accessPolicyIds: ["policy-1"],
      modelRoutingId: "routing-1",
      policyId: "runtime-default",
      skillIds: ["skill-1"],
      mcpServerIds: ["mcp-1"],
      knowledgeSourceIds: ["knowledge-1"],
      memory: { mode: "hybrid" },
    }).map(({ capability }) => capability)).toEqual([
      "CAP_AGENT_INSTANCE_ACCESS_POLICY_ASSIGN",
      "CAP_AGENT_INSTANCE_MODEL_ROUTING_ASSIGN",
      "CAP_AGENT_INSTANCE_RUNTIME_POLICY_ASSIGN",
      "CAP_AGENT_INSTANCE_SKILL_ASSIGN",
      "CAP_AGENT_INSTANCE_MCP_SERVER_ASSIGN",
      "CAP_AGENT_INSTANCE_KNOWLEDGE_SOURCE_ASSIGN",
      "CAP_AGENT_MEMORY_CONFIG_UPDATE",
      "CAP_AGENT_MEMORY_EMBEDDING_ASSIGN",
    ]);
  });

  it("does not require Memory configuration when the rollout is disabled", () => {
    expect(conditionalInstanceCreateRequirements({
      agentPlatform: "hermes",
    }, false).map(({ capability }) => capability)).toEqual([
      "CAP_AGENT_INSTANCE_ACCESS_POLICY_ASSIGN",
      "CAP_AGENT_INSTANCE_MODEL_ROUTING_ASSIGN",
    ]);
  });

  it("treats the terminal WebSocket token as the already-authorized capability", () => {
    expect(projectRouteAdmissionPolicy(
      "GET",
      "/api/v1/projects/individual/terminal-sessions/session-1/ws",
    )).toMatchObject({
      requirements: [],
      skipBecauseCapabilityToken: true,
    });
    expect(projectRouteAdmissionPolicy(
      "POST",
      "/api/v1/projects/individual/terminal-sessions/session-1/ws",
    )).toBeUndefined();
    expect(projectRouteAdmissionPolicy(
      "GET",
      "/api/v1/projects/individual/terminal-sessions/session-1/ws/extra",
    )).toBeUndefined();
    expect(projectRouteAdmissionPolicy(
      "GET",
      "/api/v1/projects/individual/agent-log-sessions/session-1/ws",
    )).toMatchObject({
      requirements: [],
      skipBecauseCapabilityToken: true,
    });
  });

  it("does not let unknown nested routes inherit a parent capability", () => {
    const unknown = [
      ["DELETE", "/api/v1/projects/individual/members/member-1/unknown"],
      ["GET", "/api/v1/projects/individual/instances/agent-1/logs/raw"],
      ["POST", "/api/v1/projects/individual/providers/provider-1/validate/again"],
      ["GET", "/api/v1/projects/individual/model-routings/routing-1/consumers/raw"],
      ["GET", "/api/v1/projects/individual/costs/summary/raw"],
    ] as const;
    for (const [method, pathname] of unknown) {
      expect(projectRouteAdmissionPolicy(method, pathname)).toBeUndefined();
    }
  });
});
