import {
  defaultAgentPlatformId,
  isAgentPlatformId,
  type ProjectCapability,
  type ResourceRelation,
} from "@tali/contracts";

export type RelationResolver =
  | "PROJECT"
  | "NEW_OWNER"
  | "INSTANCE"
  | "INSTANCE_COLLECTION"
  | "REGISTERED_AGENT";

export interface RouteCapabilityRequirement {
  capability: ProjectCapability;
  resourceType: string;
}

export interface ProjectRouteAdmissionPolicy {
  /** Route semantics consumed by conditional admission without reparsing URLs. */
  kind?: "INSTANCE_CREATE" | "AUDIT_LOG_LIST";
  relation: RelationResolver;
  requirements: readonly RouteCapabilityRequirement[];
  resourceId?: string;
  skipBecauseCapabilityToken?: boolean;
}

const requirement = (
  capability: ProjectCapability,
  resourceType: string,
): RouteCapabilityRequirement => ({ capability, resourceType });

function projectTail(pathname: string): string[] | undefined {
  const match = pathname.match(/^\/api\/v1\/projects\/([^/]+)(?:\/(.*))?$/);
  return match
    ? (match[2] ?? "").split("/").filter(Boolean).map(decodeURIComponent)
    : undefined;
}

function policy(
  relation: RelationResolver,
  requirements: readonly RouteCapabilityRequirement[],
  resourceId?: string,
  kind?: ProjectRouteAdmissionPolicy["kind"],
): ProjectRouteAdmissionPolicy {
  return {
    relation,
    requirements,
    ...(resourceId ? { resourceId } : {}),
    ...(kind ? { kind } : {}),
  };
}

function catalogCapability(
  kind: string,
  action: "CREATE" | "UPDATE" | "DELETE",
): ProjectCapability | undefined {
  return ({
    skills: `CAP_SKILL_${action}`,
    "mcp-servers": `CAP_MCP_SERVER_${action}`,
    "vector-databases": `CAP_VECTOR_DATABASE_${action}`,
  } as Record<string, ProjectCapability>)[kind];
}

/** Maps every Project-scoped HTTP route to its primary admission contract. */
export function projectRouteAdmissionPolicy(
  methodInput: string,
  pathname: string,
): ProjectRouteAdmissionPolicy | undefined {
  const method = methodInput.toUpperCase();
  const tail = projectTail(pathname);
  if (!tail) return undefined;
  if (
    method === "GET"
    && tail.length === 3
    && (tail[0] === "terminal-sessions" || tail[0] === "agent-log-sessions")
    && tail[2] === "ws"
  ) {
    return {
      relation: "PROJECT",
      requirements: [],
      skipBecauseCapabilityToken: true,
    };
  }
  if (!tail.length) {
    if (method === "PATCH") return policy("PROJECT", [requirement("CAP_PROJECT_SETTINGS_UPDATE", "Project")]);
    if (method === "DELETE") return policy("PROJECT", [requirement("CAP_PROJECT_DELETE", "Project")]);
    return undefined;
  }

  if (tail[0] === "deletion-impact" && tail.length === 1 && method === "GET") {
    return policy("PROJECT", [requirement("CAP_PROJECT_DELETE", "Project")]);
  }

  if (tail[0] === "members") {
    if (method === "GET" && tail.length === 1) {
      return policy("PROJECT", [requirement("CAP_PROJECT_MEMBER_VIEW", "ProjectMember")]);
    }
    if (method === "POST" && tail.length === 2 && tail[1] === "invitations") {
      return policy("PROJECT", [
        requirement("CAP_PROJECT_MEMBER_INVITE", "ProjectMember"),
        requirement("CAP_PROJECT_MEMBER_ROLE_ASSIGN", "ProjectRole"),
      ]);
    }
    if (method === "DELETE" && tail.length === 2 && tail[1]) {
      return policy("PROJECT", [requirement("CAP_PROJECT_MEMBER_REMOVE", "ProjectMember")], tail[1]);
    }
  }
  if (tail[0] === "role" && method === "PUT" && tail.length === 1) {
    return policy("PROJECT", [requirement("CAP_PROJECT_VIEW", "ProjectRole")]);
  }
  if (tail[0] === "quota" && tail.length === 1) {
    return method === "GET"
      ? policy("PROJECT", [requirement("CAP_PROJECT_QUOTA_VIEW", "ProjectQuota")])
      : method === "PUT"
        ? policy("PROJECT", [requirement("CAP_PROJECT_QUOTA_UPDATE", "ProjectQuota")])
        : undefined;
  }
  if (tail[0] === "runtime" && tail.length === 1 && method === "GET") {
    return policy("PROJECT", [requirement("CAP_RUNTIME_OPERATION_VIEW", "Runtime")]);
  }
  if (tail[0] === "overview" && tail.length === 1 && method === "GET") {
    return policy("PROJECT", [
      requirement("CAP_USAGE_VIEW", "Usage"),
      requirement("CAP_COST_VIEW", "Cost"),
      requirement("CAP_PROJECT_QUOTA_VIEW", "ProjectQuota"),
      requirement("CAP_AGENT_INSTANCE_CONFIG_VIEW", "AgentInstance"),
      requirement("CAP_AGENT_MEMORY_CONFIG_VIEW", "AgentMemory"),
      requirement("CAP_SKILL_VIEW", "Skill"),
      requirement("CAP_ACCESS_POLICY_VIEW", "AccessPolicy"),
    ]);
  }
  if (
    tail[0] === "authorization"
    && tail.length === 2
    && (tail[1] === "roles" || tail[1] === "capabilities")
    && method === "GET"
  ) {
    return policy("PROJECT", [requirement("CAP_PROJECT_ROLE_VIEW", "ProjectRole")]);
  }

  if (tail[0] === "instances") {
    if (tail.length === 1 && method === "GET") {
      return policy("INSTANCE_COLLECTION", [requirement("CAP_AGENT_INSTANCE_CONFIG_VIEW", "AgentInstance")]);
    }
    if (tail.length === 1 && method === "POST") {
      return policy(
        "NEW_OWNER",
        [requirement("CAP_AGENT_INSTANCE_CREATE", "AgentInstance")],
        undefined,
        "INSTANCE_CREATE",
      );
    }
    const instanceId = tail[1];
    if (!instanceId) return undefined;
    if (tail.length === 2 && method === "GET") {
      return policy("INSTANCE", [requirement("CAP_AGENT_INSTANCE_CONFIG_VIEW", "AgentInstance")], instanceId);
    }
    if (tail.length === 2 && method === "DELETE") {
      return policy("INSTANCE", [requirement("CAP_AGENT_INSTANCE_DELETE", "AgentInstance")], instanceId);
    }
    if (tail.length === 3 && tail[2] === "interaction" && method === "GET") {
      return policy("INSTANCE", [requirement("CAP_AGENT_INSTANCE_INTERACT", "AgentInstance")], instanceId);
    }
    if (tail.length === 3 && tail[2] === "logs" && method === "GET") {
      return policy("INSTANCE", [requirement("CAP_AGENT_INSTANCE_LOG_VIEW", "AgentInstance")], instanceId);
    }
    if (tail.length === 3 && tail[2] === "log-sessions" && method === "POST") {
      return policy("INSTANCE", [requirement("CAP_AGENT_INSTANCE_LOG_VIEW", "AgentInstance")], instanceId);
    }
    if (tail.length === 3 && tail[2] === "access-policies" && method === "PUT") {
      return policy("INSTANCE", [requirement("CAP_AGENT_INSTANCE_ACCESS_POLICY_ASSIGN", "AgentInstance")], instanceId);
    }
    if (tail.length === 3 && tail[2] === "audit" && method === "GET") {
      return policy("INSTANCE", [
        requirement("CAP_AUDIT_DETAIL_VIEW", "AgentInstance"),
        requirement("CAP_AUDIT_SENSITIVE_CONTENT_VIEW", "AgentInstanceAudit"),
      ], instanceId);
    }
    if (tail.length === 3 && tail[2] === "terminal-targets" && method === "GET") {
      return policy("INSTANCE", [requirement("CAP_AGENT_INSTANCE_TERMINAL_EXEC", "AgentInstance")], instanceId);
    }
    if (tail.length === 3 && tail[2] === "terminal-sessions" && method === "POST") {
      return policy("INSTANCE", [requirement("CAP_AGENT_INSTANCE_TERMINAL_EXEC", "AgentInstance")], instanceId);
    }
  }

  if (tail[0] === "agent-garden") {
    if (tail.length === 1 && method === "GET") {
      return policy("INSTANCE_COLLECTION", [
        requirement("CAP_AGENT_REGISTRATION_VIEW", "AgentRegistration"),
      ]);
    }
    if (tail.length === 2 && tail[1] === "onboard" && method === "POST") {
      return policy("NEW_OWNER", [
        requirement("CAP_AGENT_REGISTRATION_CREATE", "AgentRegistration"),
        requirement("CAP_AGENT_REGISTRATION_DISCOVER", "AgentRegistration"),
      ]);
    }
    if (tail[1] === "agents") {
      const id = tail[2];
      if (id && tail.length === 4 && tail[3] === "discover" && method === "POST") {
        return policy("REGISTERED_AGENT", [requirement("CAP_AGENT_REGISTRATION_DISCOVER", "AgentRegistration")], id);
      }
      if (id && tail.length === 4 && tail[3] === "instances" && method === "POST") {
        return policy(
          "NEW_OWNER",
          [requirement("CAP_AGENT_INSTANCE_CREATE", "AgentInstance")],
        );
      }
      if (id && tail.length === 3 && method === "DELETE") {
        return policy("REGISTERED_AGENT", [requirement("CAP_AGENT_REGISTRATION_DELETE", "AgentRegistration")], id);
      }
    }
    if (tail[1] === "instances" && tail.length === 3 && tail[2] && method === "DELETE") {
      return policy("INSTANCE", [requirement("CAP_AGENT_INSTANCE_DELETE", "AgentInstance")], tail[2]);
    }
  }

  if (tail[0] === "memories") {
    if (tail.length === 1) {
      if (method === "GET") {
        return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_ITEM_VIEW", "DurableMemory")]);
      }
      if (method === "POST") {
        return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONFIG_UPDATE", "DurableMemory")]);
      }
    }
    const memoryId = tail[1];
    if (!memoryId) return undefined;
    if (tail.length === 2) {
      if (method === "GET") {
        return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_ITEM_VIEW", "DurableMemory")], memoryId);
      }
      if (method === "PATCH") {
        return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONFIG_UPDATE", "DurableMemory")], memoryId);
      }
      if (method === "DELETE") {
        return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONTENT_PURGE", "DurableMemory")], memoryId);
      }
    }
    if (tail.length === 3 && tail[2] === "overview" && method === "GET") {
      return policy("PROJECT", [
        requirement("CAP_AGENT_MEMORY_ITEM_VIEW", "DurableMemory"),
        requirement("CAP_AGENT_MEMORY_CONTENT_VIEW", "DurableMemory"),
      ], memoryId);
    }
    if (tail.length === 3 && tail[2] === "activity" && method === "GET") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_ITEM_VIEW", "DurableMemory")], memoryId);
    }
    if (
      tail.length === 3
      && ["conversations", "facts", "experiences", "insights"].includes(tail[2]!)
      && method === "GET"
    ) {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONTENT_VIEW", "DurableMemory")], memoryId);
    }
    if (tail.length === 3 && tail[2] === "settings" && method === "GET") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONFIG_VIEW", "DurableMemory")], memoryId);
    }
    if (tail.length === 3 && tail[2] === "retry" && method === "POST") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONFIG_UPDATE", "DurableMemory")], memoryId);
    }
    if (tail.length === 3 && tail[2] === "bindings" && method === "GET") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONFIG_VIEW", "DurableMemory")], memoryId);
    }
    if (tail.length === 3 && tail[2] === "bindings" && method === "POST") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONFIG_UPDATE", "DurableMemory")], memoryId);
    }
    if (tail.length === 4 && tail[2] === "bindings" && method === "DELETE") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONFIG_UPDATE", "DurableMemory")], memoryId);
    }
    if (tail.length === 3 && tail[2] === "outbox" && method === "GET") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_INDEX_STATUS_VIEW", "DurableMemory")], memoryId);
    }
    if (tail.length === 3 && tail[2] === "exports" && method === "POST") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_EXPORT", "DurableMemory")], memoryId);
    }
    if (tail.length === 4 && tail[2] === "exports" && method === "GET") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_EXPORT", "DurableMemory")], memoryId);
    }
    if (tail.length === 4 && tail[2] === "items" && method === "GET") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONTENT_VIEW", "DurableMemory")], memoryId);
    }
    if (tail.length === 4 && tail[2] === "facts" && method === "PATCH") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONTENT_WRITE", "DurableMemory")], memoryId);
    }
    if (tail.length === 4 && tail[2] === "experiences" && method === "PATCH") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONTENT_WRITE", "DurableMemory")], memoryId);
    }
    if (
      tail.length === 5
      && tail[2] === "items"
      && ["invalidate", "restore"].includes(tail[4]!)
      && method === "POST"
    ) {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONTENT_WRITE", "DurableMemory")], memoryId);
    }
    if (tail.length === 4 && tail[2] === "conversations" && method === "GET") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONTENT_VIEW", "DurableMemory")], memoryId);
    }
    if (tail.length === 4 && tail[2] === "conversations" && method === "DELETE") {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONTENT_DELETE", "DurableMemory")], memoryId);
    }
    if (
      tail.length === 5
      && tail[2] === "conversations"
      && tail[4] === "reextract"
      && method === "POST"
    ) {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_SESSION_INDEX_MANAGE", "DurableMemory")], memoryId);
    }
    if (
      tail.length === 5
      && tail[2] === "conversations"
      && tail[4] === "redact"
      && method === "POST"
    ) {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_CONTENT_WRITE", "DurableMemory")], memoryId);
    }
    if (
      tail.length === 5
      && tail[2] === "outbox"
      && tail[4] === "replay"
      && method === "POST"
    ) {
      return policy("PROJECT", [requirement("CAP_AGENT_MEMORY_INDEX_REBUILD", "DurableMemory")], memoryId);
    }
  }

  if (tail[0] === "access-policies") {
    if (tail.length === 1) {
      if (method === "GET") return policy("PROJECT", [requirement("CAP_ACCESS_POLICY_VIEW", "AccessPolicy")]);
      if (method === "POST") return policy("PROJECT", [requirement("CAP_ACCESS_POLICY_CREATE", "AccessPolicy")]);
    }
    const policyId = tail[1];
    if (!policyId) return undefined;
    if (tail.length === 3 && tail[2] === "versions" && method === "GET") {
      return policy("PROJECT", [requirement("CAP_ACCESS_POLICY_VERSION_VIEW", "AccessPolicy")], policyId);
    }
    if (tail.length === 2 && method === "GET") return policy("PROJECT", [requirement("CAP_ACCESS_POLICY_VIEW", "AccessPolicy")], policyId);
    if (tail.length === 2 && method === "PUT") return policy("PROJECT", [requirement("CAP_ACCESS_POLICY_UPDATE", "AccessPolicy")], policyId);
    if (tail.length === 2 && method === "DELETE") return policy("PROJECT", [requirement("CAP_ACCESS_POLICY_DELETE", "AccessPolicy")], policyId);
  }

  if (tail[0] === "catalog") {
    if (tail.length === 1 && method === "GET") {
      return policy("PROJECT", [
        requirement("CAP_SKILL_VIEW", "Skill"),
        requirement("CAP_MCP_SERVER_VIEW", "McpServer"),
        requirement("CAP_VECTOR_DATABASE_VIEW", "VectorDatabase"),
        requirement("CAP_AGENT_SPECIALIZATION_VIEW", "AgentSpecialization"),
      ]);
    }
    if (tail.length === 4 && tail[1] === "mcp-servers" && tail[3] === "discover" && method === "POST") {
      return policy("PROJECT", [requirement("CAP_MCP_SERVER_DISCOVER", "McpServer")], tail[2]);
    }
    if (tail.length === 4 && tail[1] === "skills" && tail[3] === "archive" && method === "GET") {
      return policy("PROJECT", [requirement("CAP_SKILL_ARTIFACT_DOWNLOAD", "SkillArtifact")], tail[2]);
    }
    if (tail.length === 4 && tail[1] === "skills" && tail[3] === "verify" && method === "POST") {
      return policy("PROJECT", [requirement("CAP_SKILL_VERIFY", "Skill")], tail[2]);
    }
    if (
      tail.length === 4
      && tail[1] === "vector-databases"
      && tail[3] === "chunks"
      && method === "PUT"
    ) {
      return policy(
        "PROJECT",
        [requirement("CAP_VECTOR_DATABASE_UPDATE", "VectorChunk")],
        tail[2],
      );
    }
    if (
      tail.length === 4
      && tail[1] === "vector-databases"
      && tail[3] === "documents"
      && method === "POST"
    ) {
      return policy(
        "PROJECT",
        [requirement("CAP_VECTOR_DATABASE_UPDATE", "VectorDocument")],
        tail[2],
      );
    }
    if (
      tail[1] === "vector-databases"
      && tail[3] === "folders"
      && ((tail.length === 4 && method === "POST")
        || (tail.length === 5 && (method === "PATCH" || method === "DELETE")))
    ) {
      return policy(
        "PROJECT",
        [requirement("CAP_VECTOR_DATABASE_UPDATE", "VectorFolder")],
        tail[2],
      );
    }
    if (
      tail.length === 5
      && tail[1] === "vector-databases"
      && tail[3] === "chunks"
      && method === "DELETE"
    ) {
      return policy(
        "PROJECT",
        [requirement("CAP_VECTOR_DATABASE_UPDATE", "VectorChunk")],
        tail[2],
      );
    }
    if (
      tail[1] === "vector-databases"
      && tail.length === 3
      && method === "GET"
    ) {
      return policy("PROJECT", [requirement("CAP_VECTOR_DATABASE_VIEW", "VectorDatabase")], tail[2]);
    }
    if (
      tail[1] === "vector-databases"
      && tail.length === 4
      && tail[3] === "search"
      && method === "POST"
    ) {
      return policy("PROJECT", [requirement("CAP_VECTOR_DATABASE_CONTENT_VIEW", "VectorDatabase")], tail[2]);
    }
    if (
      tail[1] === "vector-databases"
      && tail.length === 5
      && tail[3] === "documents"
      && (method === "GET" || method === "PATCH" || method === "DELETE")
    ) {
      return policy(
        "PROJECT",
        [requirement(method === "GET" ? "CAP_VECTOR_DATABASE_CONTENT_VIEW" : "CAP_VECTOR_DATABASE_UPDATE", "VectorDocument")],
        tail[2],
      );
    }
    const action = method === "POST" && tail.length === 2
      ? "CREATE"
      : method === "PUT" && tail.length === 3
        ? "UPDATE"
        : method === "DELETE" && tail.length === 3
          ? "DELETE"
          : undefined;
    const capability = action ? catalogCapability(tail[1] ?? "", action) : undefined;
    if (capability) {
      return policy("PROJECT", [requirement(capability, tail[1] ?? "CatalogResource")], tail[2]);
    }
  }

  if (tail[0] === "runtime-policies") {
    if (tail.length === 1 && method === "GET") return policy("PROJECT", [requirement("CAP_RUNTIME_POLICY_VIEW", "RuntimePolicy")]);
    if (tail.length === 1 && method === "POST") return policy("PROJECT", [requirement("CAP_RUNTIME_POLICY_CREATE", "RuntimePolicy")]);
    if (tail.length === 2 && tail[1] && method === "PUT") return policy("PROJECT", [requirement("CAP_RUNTIME_POLICY_UPDATE", "RuntimePolicy")], tail[1]);
    if (tail.length === 2 && tail[1] && method === "DELETE") return policy("PROJECT", [requirement("CAP_RUNTIME_POLICY_DELETE", "RuntimePolicy")], tail[1]);
  }

  if (tail[0] === "providers") {
    if (tail.length === 1 && method === "GET") return policy("PROJECT", [requirement("CAP_PROVIDER_VIEW", "Provider")]);
    if (tail.length === 1 && method === "POST") return policy("PROJECT", [requirement("CAP_PROVIDER_CREATE", "Provider")]);
    if (tail.length === 2 && tail[1] === "discover" && method === "POST") return policy("PROJECT", [requirement("CAP_PROVIDER_DISCOVER", "Provider")]);
    if (tail.length === 3 && tail[2] === "discover" && method === "POST") return policy("PROJECT", [requirement("CAP_PROVIDER_DISCOVER", "Provider")], tail[1]);
    if (tail.length === 3 && tail[2] === "validate" && method === "POST") return policy("PROJECT", [requirement("CAP_PROVIDER_VALIDATE", "Provider")], tail[1]);
    if (tail.length === 2 && tail[1] && method === "DELETE") return policy("PROJECT", [requirement("CAP_PROVIDER_DELETE", "Provider")], tail[1]);
  }

  if (tail[0] === "models") {
    if (tail.length === 1 && method === "GET") return policy("PROJECT", [requirement("CAP_MODEL_VIEW", "Model")]);
    if (tail.length === 1 && method === "POST") return policy("PROJECT", [requirement("CAP_MODEL_CREATE", "Model")]);
    if (tail.length === 2 && tail[1] === "inheritable" && method === "GET") return policy("PROJECT", [requirement("CAP_MODEL_VIEW", "Model")]);
    if (tail.length === 3 && tail[2] === "inherit" && method === "POST") return policy("PROJECT", [requirement("CAP_MODEL_CREATE", "Model")], tail[1]);
    if (tail.length === 3 && tail[2] === "inherit" && method === "DELETE") return policy("PROJECT", [requirement("CAP_MODEL_DELETE", "Model")], tail[1]);
    if (tail.length === 2 && tail[1] && method === "DELETE") return policy("PROJECT", [requirement("CAP_MODEL_DELETE", "Model")], tail[1]);
  }
  if (tail[0] === "inference-gateways" && tail.length === 1 && method === "GET") {
    return policy("PROJECT", [requirement("CAP_INFERENCE_GATEWAY_VIEW", "InferenceGateway")]);
  }

  if (tail[0] === "model-routings") {
    if (tail.length === 1 && method === "GET") return policy("PROJECT", [requirement("CAP_MODEL_ROUTING_VIEW", "ModelRouting")]);
    if (tail.length === 1 && method === "POST") return policy("PROJECT", [requirement("CAP_MODEL_ROUTING_CREATE", "ModelRouting")]);
    if (tail.length === 2 && tail[1] === "inheritable" && method === "GET") return policy("PROJECT", [requirement("CAP_MODEL_ROUTING_VIEW", "ModelRouting")]);
    const id = tail[1];
    if (!id) return undefined;
    if (tail.length === 3 && tail[2] === "inherit" && method === "POST") return policy("PROJECT", [requirement("CAP_MODEL_ROUTING_CREATE", "ModelRouting")], id);
    if (tail.length === 3 && tail[2] === "inherit" && method === "DELETE") return policy("PROJECT", [requirement("CAP_MODEL_ROUTING_DELETE", "ModelRouting")], id);
    if ((tail.length === 2 || (tail.length === 3 && tail[2] === "consumers")) && method === "GET") {
      return policy("PROJECT", [requirement("CAP_MODEL_ROUTING_VIEW", "ModelRouting")], id);
    }
    if (tail.length === 3 && tail[2] === "audit" && method === "GET") {
      return policy("PROJECT", [requirement("CAP_AUDIT_VIEW", "ModelRouting")], id);
    }
    if (tail.length === 3 && tail[2] === "refresh" && method === "POST") {
      return policy("PROJECT", [requirement("CAP_MODEL_ROUTING_RECONCILE", "ModelRouting")], id);
    }
    if (tail.length === 2 && method === "PUT") return policy("PROJECT", [requirement("CAP_MODEL_ROUTING_UPDATE", "ModelRouting")], id);
    if (tail.length === 2 && method === "DELETE") return policy("PROJECT", [requirement("CAP_MODEL_ROUTING_DELETE", "ModelRouting")], id);
  }

  if (tail[0] === "audit-logs") {
    if (tail.length === 2 && tail[1] === "export" && method === "GET") {
      return policy("PROJECT", [requirement("CAP_AUDIT_EXPORT", "AuditLog")]);
    }
    if (tail.length === 1 && method === "GET") {
      return policy(
        "PROJECT",
        [requirement("CAP_AUDIT_DETAIL_VIEW", "AuditLog")],
        undefined,
        "AUDIT_LOG_LIST",
      );
    }
  }
  if (tail[0] === "traces") {
    if (tail.length === 1 && method === "GET") return policy("PROJECT", [requirement("CAP_TRACE_VIEW", "Trace")]);
    if (tail.length === 2 && tail[1] && method === "GET") return policy("PROJECT", [requirement("CAP_TRACE_CONTENT_VIEW", "Trace")], tail[1]);
  }
  if (tail[0] === "costs" && tail.length === 2 && method === "GET") {
    const requirements = [requirement("CAP_COST_VIEW", "Cost")];
    if (tail[1] === "data-quality") {
      requirements.push(requirement("CAP_USAGE_DATA_QUALITY_VIEW", "Usage"));
    }
    return policy("PROJECT", requirements);
  }
  return undefined;
}

export function conditionalInstanceCreateRequirements(
  input: Record<string, unknown>,
): readonly RouteCapabilityRequirement[] {
  const requirements: RouteCapabilityRequirement[] = [
    requirement("CAP_AGENT_INSTANCE_ACCESS_POLICY_ASSIGN", "AgentInstance"),
    requirement("CAP_AGENT_INSTANCE_MODEL_ROUTING_ASSIGN", "AgentInstance"),
  ];
  if (typeof input.policyId === "string") {
    requirements.push(requirement("CAP_AGENT_INSTANCE_RUNTIME_POLICY_ASSIGN", "AgentInstance"));
  }
  if (Array.isArray(input.skillIds) && input.skillIds.length) {
    requirements.push(requirement("CAP_AGENT_INSTANCE_SKILL_ASSIGN", "AgentInstance"));
  }
  if (Array.isArray(input.mcpServerIds) && input.mcpServerIds.length) {
    requirements.push(requirement("CAP_AGENT_INSTANCE_MCP_SERVER_ASSIGN", "AgentInstance"));
  }
  if (Array.isArray(input.knowledgeSourceIds) && input.knowledgeSourceIds.length) {
    requirements.push(requirement("CAP_AGENT_INSTANCE_KNOWLEDGE_SOURCE_ASSIGN", "AgentInstance"));
  }
  const requestedPlatform = typeof input.agentPlatform === "string"
    && isAgentPlatformId(input.agentPlatform)
    ? input.agentPlatform
    : defaultAgentPlatformId;
  if (requestedPlatform === "openclaw" || requestedPlatform === "hermes") {
    requirements.push(requirement("CAP_AGENT_MEMORY_CONFIG_UPDATE", "AgentMemory"));
  }
  const memory = input.memory;
  if (memory && typeof memory === "object" && (memory as { mode?: unknown }).mode === "hybrid") {
    requirements.push(requirement("CAP_AGENT_MEMORY_EMBEDDING_ASSIGN", "AgentMemory"));
  }
  return requirements;
}

/** Additional requirements derived from request content after route matching. */
export function conditionalRequestRequirements(
  admission: ProjectRouteAdmissionPolicy,
  url: URL,
  input: Record<string, unknown> = {},
): readonly RouteCapabilityRequirement[] {
  if (admission.kind === "INSTANCE_CREATE") {
    return conditionalInstanceCreateRequirements(input);
  }
  if (
    admission.kind === "AUDIT_LOG_LIST"
    && url.searchParams.get("include_sensitive") === "true"
  ) {
    return [requirement("CAP_AUDIT_SENSITIVE_CONTENT_VIEW", "AuditLog")];
  }
  return [];
}

export function concreteRelation(
  resolver: RelationResolver,
  ownedByActor: boolean,
  collectionRole?: "admin" | "auditor" | "developer" | "user" | "reviewer",
): ResourceRelation {
  if (resolver === "NEW_OWNER") return "OWNER";
  if (resolver === "INSTANCE_COLLECTION") {
    // ASSIGNED must be proven by a persisted per-resource binding. A role name
    // alone is not assignment evidence; until that model exists Users fail
    // closed on Instance collections.
    if (collectionRole === "developer") return "OWNER";
    return "PROJECT_ANY";
  }
  if (resolver === "INSTANCE" || resolver === "REGISTERED_AGENT") {
    return ownedByActor ? "OWNER" : "PROJECT_ANY";
  }
  return "PROJECT_ANY";
}
