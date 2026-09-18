import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { betterAuthSessionCookieName } from "../auth/cookies";
import { apiContracts } from "./index";
import { createOpenApiDocument } from "./openapi";

const routeRoot = fileURLToPath(new URL("../routes/api/v1", import.meta.url));

function localReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(localReferences);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(key === "$ref" && typeof item === "string" && item.startsWith("#/") ? [item] : []),
    ...localReferences(item),
  ]);
}

function resolveLocalReference(document: unknown, reference: string): unknown {
  return reference.slice(2).split("/").reduce<unknown>((value, token) => {
    if (!value || typeof value !== "object") return undefined;
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    return (value as Record<string, unknown>)[key];
  }, document);
}

function filesystemOperations(): string[] {
  return readdirSync(routeRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(get|post|put|patch|delete)\.ts$/.test(entry.name))
    .map((entry) => `${entry.parentPath}/${entry.name}`.slice(routeRoot.length + 1))
    .filter((file) => file !== "openapi.json.get.ts")
    .map((file) => {
      const match = file.match(/\.(get|post|put|patch|delete)\.ts$/)!;
      const method = match[1]!.toUpperCase();
      const withoutMethod = file.slice(0, -match[0].length)
        .replace(/(^|\/)index$/, "")
        .replaceAll(/\[([^\]]+)\]/g, "{$1}");
      return `${method} /${withoutMethod}`.replace(/\/$/, "");
    })
    .sort();
}

describe("business API contracts", () => {
  it("has exactly one contract for every HTTP handler", () => {
    const contracts = apiContracts
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`)
      .sort();
    expect(new Set(contracts).size).toBe(contracts.length);
    expect(contracts).toEqual(filesystemOperations());
  });

  it("generates complete OpenAPI operations", () => {
    const document = createOpenApiDocument();
    const operations = Object.values(document.paths)
      .flatMap((path) => Object.values(path)) as Array<{
        description: string;
        operationId: string;
        responses: Record<string, unknown>;
        summary: string;
        tags: string[];
      }>;
    expect(operations).toHaveLength(apiContracts.length);
    expect(new Set(operations.map(({ operationId }) => operationId)).size).toBe(operations.length);
    for (const operation of operations) {
      expect(operation.summary).toBeTruthy();
      expect(operation.description).toBeTruthy();
      expect(operation.tags.length).toBeGreaterThan(0);
      expect(operation.responses["500"]).toBeDefined();
    }
  });

  it("publishes reusable components with resolvable local references", () => {
    const document = createOpenApiDocument();
    expect(document.components.securitySchemes.sessionCookie.name).toBe(
      betterAuthSessionCookieName,
    );
    expect(
      document.components.securitySchemes.projectRuntimeCoordinatorToken.name,
    ).toBe("x-tali-coordinator-token");
    expect(Object.keys(document.components.schemas).length).toBeGreaterThan(10);
    const references = localReferences(document);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(resolveLocalReference(document, reference), reference).toBeDefined();
    }
  });

  it("keeps path variables, auth errors, and Capability admission explicit", () => {
    const document = createOpenApiDocument();
    for (const contract of apiContracts) {
      const expectedParams = [...contract.path.matchAll(/\{([^}]+)\}/g)]
        .map((match) => match[1])
        .sort();
      const params = contract.request?.params;
      const actualParams = params instanceof z.ZodObject
        ? Object.keys(params.shape).sort()
        : [];
      expect(actualParams, `${contract.method} ${contract.path}`).toEqual(expectedParams);

      const operation = document.paths[contract.path]![contract.method] as {
        responses: Record<string, unknown>;
        "x-tali-capabilities"?: string[];
      };
      if ((contract.auth ?? "session") === "session") {
        expect(operation.responses["401"]).toBeDefined();
      }
      if (contract.path.startsWith("/projects/{projectId}")) {
        expect(operation.responses["403"]).toBeDefined();
        expect(operation["x-tali-capabilities"]?.length).toBeGreaterThan(0);
      }
    }
  });

  it("contains the canonical names and status codes only", () => {
    const document = createOpenApiDocument();
    expect(document.paths["/profile"]).toBeDefined();
    expect(document.paths["/routing"]).toBeUndefined();
    expect(document.paths["/projects/{projectId}/runtime-policies"]).toBeDefined();
    expect(document.paths["/projects/{projectId}/policies"]).toBeUndefined();
    expect(document.paths["/projects/{projectId}/agent-garden/onboard"]?.post)
      .toMatchObject({
        operationId: "onboardGardenAgent",
        summary: "Onboard an A2A Agent into the Project Agent Garden",
        responses: { 202: expect.anything() },
      });
    for (const operationId of ["getDemoAgentCard", "sendDemoAgentMessage", "listRuntimeBridgeAgents", "getRuntimeBridgeAgentCard", "sendRuntimeBridgeAgentMessage", "listRuntimeBridgeVectorDatabases", "searchRuntimeBridgeVectorDatabase", "recallRuntimeMemory"]) {
      const contract = apiContracts.find((item) => item.operationId === operationId)!;
      expect(contract.responses, operationId).toHaveProperty("200");
      expect(contract.responses, operationId).not.toHaveProperty("202");
    }
    const onboardSchema = document.components.schemas.OnboardAgentInput as {
      oneOf: Array<{
        properties: Record<string, unknown>;
      }>;
    };
    const existingAgent = onboardSchema.oneOf.find((variant) =>
      JSON.stringify(variant.properties.sourceType).includes("existing-agent")
    );
    expect(Object.keys(existingAgent?.properties ?? {}).sort()).toEqual([
      "agentCardUrl",
      "authReference",
      "authType",
      "category",
      "description",
      "internalNetworkOnly",
      "name",
      "owner",
      "sourceType",
      "tags",
    ]);
    expect(document.paths["/projects/{projectId}/agent-garden/agents"])
      .toBeUndefined();
    const deleteProject = document.paths["/projects/{projectId}"]!.delete as {
      responses: Record<string, unknown>;
    };
    const createInstance = document.paths["/projects/{projectId}/instances"]!.post as {
      operationId: string;
    };
    expect(deleteProject.responses["202"]).toBeDefined();
    expect(createInstance.operationId).toBe("createInstance");
  });
});
