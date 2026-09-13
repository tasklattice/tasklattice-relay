import { z, type ZodType } from "zod";
import { betterAuthSessionCookieName } from "../auth/cookies";
import { projectRouteAdmissionPolicy } from "../authorization/route-capabilities";
import { apiContracts } from "./index";
import { problemDetailsSchema } from "./schemas";

type JsonSchema = Record<string, unknown>;

const tagDescriptions: Record<string, string> = {
  "Access policies": "Tool and MCP access rules assigned to runtime Instances.",
  "Agent Garden": "Registered and built-in Agents that can collaborate with runtime Instances.",
  "Audit logs": "Project-scoped governance and security audit events.",
  Authentication: "Business API session discovery. Better Auth protocol endpoints live under /api/auth.",
  Costs: "Project inference cost analytics.",
  Departments: "Organization and budget grouping. Department roles do not grant Project business access.",
  "Demo Agents": "Public deterministic Agent endpoints used for product demonstrations.",
  "Agent Developer": "Direct Agent development, exact-digest testing, and immutable Version publication to Agent Garden.",
  "Agent Runtime": "Version-pinned resource access and runtime telemetry for materialized Agent Instances.",
  "Inference gateways": "Project-bound LiteLLM gateway projections.",
  Instances: "Business runtime Instances provisioned inside a Project.",
  "Model routing": "Project model routing and its consumer bindings.",
  Models: "Model deployments made available to a Project.",
  Memory: "Project-scoped durable context that survives Agent replacement.",
  Notifications: "Personal in-app notifications.",
  "Platform administration": "Platform Administrator settings and organization-wide operations.",
  Profile: "Personal preferences and credential management.",
  "Project members": "Project membership and Project-scoped role selection.",
  Projects: "Business isolation, authorization, and runtime ownership boundary.",
  Providers: "Provider credentials and model discovery.",
  Quota: "Project budget and resource quotas.",
  "Resource catalog": "Skills, MCP servers, and Vector Databases available to a Project.",
  Runtime: "Runtime and runner health.",
  "Runtime Bridge": "Project-isolated capability discovery and A2A delegation proxy.",
  "Runtime policies": "Sandbox execution constraints used by runtime Instances.",
  Traces: "Project runtime trace inspection.",
  Authorization: "Project Capability and built-in role definitions.",
};

function schemaId(schema: ZodType): string | undefined {
  const id = schema.meta()?.id;
  return typeof id === "string" && id ? id : undefined;
}

function jsonSchema(
  schema: ZodType,
  io: "input" | "output",
  referenceNamed = true,
): JsonSchema {
  const id = schemaId(schema);
  if (referenceNamed && id) return { $ref: `#/components/schemas/${id}` };
  const converted = z.toJSONSchema(schema, {
    io,
    target: "draft-2020-12",
    unrepresentable: "any",
  }) as JsonSchema;
  delete converted.$schema;
  return converted;
}

function componentSchemas(): Record<string, JsonSchema> {
  const schemas = new Map<string, { io: "input" | "output"; schema: ZodType }>();
  const add = (id: string, io: "input" | "output", schema: ZodType) => {
    const existing = schemas.get(id);
    if (existing && existing.schema !== schema) {
      throw new Error(`Duplicate OpenAPI schema id: ${id}`);
    }
    schemas.set(id, { io, schema });
  };
  add("ProblemDetails", "output", problemDetailsSchema);
  for (const contract of apiContracts) {
    for (const schema of [
      contract.request?.body,
      contract.request?.params,
      contract.request?.query,
    ]) {
      const id = schema ? schemaId(schema) : undefined;
      if (id && schema) add(id, "input", schema);
    }
    for (const item of Object.values(contract.responses)) {
      const id = item.schema ? schemaId(item.schema) : undefined;
      if (id && item.schema) add(id, "output", item.schema);
    }
  }
  return Object.fromEntries([...schemas].map(([id, { io, schema }]) => [
    id,
    jsonSchema(schema, io, false),
  ]));
}

function normalizeSchemaReferences(document: JsonSchema): void {
  const components = (document.components as JsonSchema).schemas as Record<string, JsonSchema>;
  const visited = new Set<object>();

  const visit = (value: unknown, rootComponent?: string): void => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, rootComponent);
      return;
    }

    const object = value as JsonSchema;
    const definitions = object.$defs;
    if (definitions && typeof definitions === "object" && !Array.isArray(definitions)) {
      for (const [id, definition] of Object.entries(definitions as Record<string, unknown>)) {
        if (!definition || typeof definition !== "object" || Array.isArray(definition)) continue;
        components[id] ??= definition as JsonSchema;
        visit(components[id], id);
      }
      delete object.$defs;
    }

    if (typeof object.$ref === "string") {
      if (object.$ref.startsWith("#/$defs/")) {
        object.$ref = `#/components/schemas/${object.$ref.slice("#/$defs/".length)}`;
      } else if (object.$ref === "#" && rootComponent) {
        object.$ref = `#/components/schemas/${rootComponent}`;
      }
    }
    for (const item of Object.values(object)) visit(item, rootComponent);
  };

  for (const [id, schema] of Object.entries(components)) visit(schema, id);
  for (const [key, value] of Object.entries(document)) {
    if (key !== "components") visit(value);
  }
}

function objectShape(schema: ZodType): Record<string, ZodType> {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error("Path and query contracts must use z.object().");
  }
  return schema.shape as Record<string, ZodType>;
}

function parameters(schema: ZodType | undefined, location: "path" | "query") {
  if (!schema) return [];
  return Object.entries(objectShape(schema)).map(([name, field]) => ({
    name,
    in: location,
    required: location === "path" || !field.safeParse(undefined).success,
    schema: jsonSchema(field, "input"),
  }));
}

function successResponses(contract: (typeof apiContracts)[number]) {
  return Object.fromEntries(Object.entries(contract.responses).map(([status, item]) => [
    status,
    {
      description: item.description,
      ...(item.schema ? {
        content: {
          [item.contentType ?? "application/json"]: {
            schema: jsonSchema(item.schema, "output"),
          },
        },
      } : {}),
    },
  ]));
}

function errorResponses(contract: (typeof apiContracts)[number]) {
  const errors: Record<string, unknown> = {};
  const problem = { $ref: "#/components/responses/Problem" };
  if (contract.request?.body || contract.request?.params || contract.request?.query) errors["400"] = problem;
  if ((contract.auth ?? "session") !== "public") errors["401"] = problem;
  if (
    contract.path.startsWith("/projects/{projectId}")
    || contract.path.startsWith("/platform/")
  ) errors["403"] = problem;
  if (contract.path.includes("{") && !contract.responses[404]) errors["404"] = problem;
  errors["500"] = problem;
  return errors;
}

function concretePath(path: string): string {
  const examples: Record<string, string> = {
    projectId: "project-1",
    kind: "skills",
    id: "resource-1",
  };
  return `/api/v1${path}`.replaceAll(
    /\{([^}]+)\}/g,
    (_placeholder, name: string) => examples[name] ?? "00000000-0000-4000-8000-000000000000",
  );
}

function operation(contract: (typeof apiContracts)[number]) {
  const pathParameters = parameters(contract.request?.params, "path");
  const queryParameters = parameters(contract.request?.query, "query");
  const admission = contract.path.startsWith("/projects/{projectId}")
    ? projectRouteAdmissionPolicy(contract.method, concretePath(contract.path))
    : undefined;
  return {
    operationId: contract.operationId,
    summary: contract.summary,
    description: contract.description,
    tags: [...contract.tags],
    security: (contract.auth ?? "session") === "public"
      ? []
      : contract.auth === "runtime-bridge"
        ? [{
            projectRuntimeBridgeBearer: [],
            projectRuntimeCoordinatorToken: [],
          }]
        : contract.auth === "expert-agent-runtime"
          ? [{
              projectRuntimeBridgeBearer: [],
              projectRuntimeExpertAgentToken: [],
              projectRuntimeExpertAgentId: [],
              projectRuntimeExpertAgentVersionId: [],
              projectRuntimeExpertAgentContentDigest: [],
            }]
        : [{ sessionCookie: [] }],
    ...(pathParameters.length || queryParameters.length
      ? { parameters: [...pathParameters, ...queryParameters] }
      : {}),
    ...(contract.request?.body ? {
      requestBody: {
        required: true,
        content: {
          [contract.request.contentType ?? "application/json"]: {
            schema: jsonSchema(contract.request.body, "input"),
          },
        },
      },
    } : {}),
    responses: { ...successResponses(contract), ...errorResponses(contract) },
    ...(admission ? {
      "x-tali-capabilities": admission.requirements.map(({ capability }) => capability),
      "x-tali-resource-relation": admission.relation,
    } : {}),
  };
}

function paths() {
  const result: Record<string, Record<string, unknown>> = {};
  for (const contract of apiContracts) {
    result[contract.path] ??= {};
    result[contract.path]![contract.method] = operation(contract);
  }
  return result;
}

export function createOpenApiDocument() {
  const document = {
    openapi: "3.1.1",
    info: {
      title: "TaskLattice Relay Business API",
      version: "0.2.0",
      description: [
        "Contract-first REST API for Department organization, Project business boundaries,",
        "and Project-owned AI runtime resources. Better Auth owns authentication protocol",
        "endpoints under /api/auth; this document describes the Relay business API only.",
      ].join(" "),
    },
    servers: [{ url: "/api/v1", description: "Same-origin business API" }],
    tags: Object.entries(tagDescriptions).map(([name, description]) => ({ name, description })),
    paths: paths(),
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: betterAuthSessionCookieName,
          description: "HttpOnly Better Auth session cookie. The cookie name may be prefixed in secure deployments.",
        },
        projectRuntimeBridgeBearer: {
          type: "http",
          scheme: "bearer",
          description: "Project and Runtime Namespace scoped HMAC token provisioned only to that Project's Runtime Bridge.",
        },
        projectRuntimeCoordinatorToken: {
          type: "apiKey",
          in: "header",
          name: "x-tali-coordinator-token",
          description: "Project, Runtime Namespace, and Coordinator Instance scoped HMAC token provisioned only to that Supervisor.",
        },
        projectRuntimeExpertAgentToken: {
          type: "apiKey",
          in: "header",
          name: "x-tali-expert-agent-token",
          description: "Project, Runtime Namespace, Agent, immutable Version, and content digest scoped HMAC token.",
        },
        projectRuntimeExpertAgentId: {
          type: "apiKey",
          in: "header",
          name: "x-tali-expert-agent-id",
          description: "Agent identity bound into the Agent Runtime token.",
        },
        projectRuntimeExpertAgentVersionId: {
          type: "apiKey",
          in: "header",
          name: "x-tali-expert-agent-version-id",
          description: "Immutable Version identity bound into the Agent Runtime token.",
        },
        projectRuntimeExpertAgentContentDigest: {
          type: "apiKey",
          in: "header",
          name: "x-tali-expert-agent-content-digest",
          description: "Immutable Version content digest bound into the Agent Runtime token.",
        },
      },
      schemas: componentSchemas(),
      responses: {
        Problem: {
          description: "An RFC 9457 problem response.",
          content: {
            "application/problem+json": {
              schema: { $ref: "#/components/schemas/ProblemDetails" },
            },
          },
        },
      },
    },
  } as const;
  normalizeSchemaReferences(document as unknown as JsonSchema);
  return document;
}

export const openApiDocument = createOpenApiDocument();
