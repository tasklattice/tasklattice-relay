import { describe, expect, it } from "vitest";
import type {
  ModelDeployment,
  ModelRouting,
  ProviderAccount,
} from "@tali/contracts";
import { ProjectStore } from "../projects/project-store";
import { createTestPrisma } from "../test/prisma";
import { DepartmentInferenceStore } from "./department-inference-store";
import { DepartmentResourceAssignmentService } from "./department-resource-assignment-service";

const modelId = "11111111-1111-4111-8111-111111111111";
const routingId = "22222222-2222-4222-8222-222222222222";
const replacementModelId = "44444444-4444-4444-8444-444444444444";

function provider(now: string): ProviderAccount {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Department OpenAI",
    providerKind: "custom-openai-compatible",
    presetId: "custom-openai-compatible",
    endpoint: "https://models.department.test/v1",
    config: {},
    complianceDomain: "GLOBAL",
    endpointRegion: "global-test-1",
    crossBorderTransfer: false,
    discoveredModels: ["department-chat"],
    status: "VALIDATED",
    checks: [],
    credentialState: "STORED",
    validationMessage: "Ready",
    validatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function model(now: string, displayName = "Department Chat"): ModelDeployment {
  return {
    id: modelId,
    providerAccountId: provider(now).id,
    modelId: "department-chat",
    displayName,
    modelType: "llm",
    capabilities: ["reasoning", "tool-calling"],
    inputModalities: ["text"],
    outputModalities: ["text"],
    providerPresetId: "custom-openai-compatible",
    providerName: "Department OpenAI",
    endpoint: "https://models.department.test/v1",
    complianceDomain: "GLOBAL",
    endpointRegion: "global-test-1",
    crossBorderTransfer: false,
    litellmModelName: "department-chat",
    status: "VALIDATED",
    checks: [],
    validationMessage: "Ready",
    validatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function embeddingModel(now: string): ModelDeployment {
  return {
    ...model(now, "Department Embedding"),
    modelId: "department-embedding",
    modelType: "text-embedding",
    capabilities: [],
    outputModalities: ["embedding"],
  };
}

function routing(now: string, description = "Shared Department route"): ModelRouting {
  return {
    id: routingId,
    name: "Department production",
    description,
    gatewayId: "litellm-default",
    managementMode: "LITELLM_MANAGED",
    publicModelAlias: "department-production",
    routingPolicy: {
      version: 1,
      mode: "SINGLE",
      modelDeploymentId: modelId,
      fallbackModelDeploymentIds: [],
      retries: 2,
    },
    complianceDomain: "GLOBAL",
    status: "READY",
    isDefault: false,
    keyPolicy: { perInstance: true, rotationDays: 90 },
    auditPolicy: {
      controlPlane: true,
      requestLogs: true,
      capturePrompts: false,
    },
    capabilities: {
      automaticRouting: "DISABLED",
      routerType: "OTHER",
      sessionAffinity: "UNKNOWN",
      adaptiveRouting: "UNKNOWN",
      failover: "DISABLED",
      generalFallback: "DISABLED",
      contextWindowFallback: "UNKNOWN",
      contentPolicyFallback: "UNKNOWN",
      retries: "ENABLED",
      requestAudit: "ENABLED",
    },
    conditions: [],
    configurationHash: "sha256:department-route",
    observedGeneration: 1,
    validationMessage: "Ready",
    consumers: 0,
    lastSynchronizedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Department inference inheritance", () => {
  it("keeps Project inheritance read-only and resolves current Department data by ID", async () => {
    const db = createTestPrisma();
    const department = new DepartmentInferenceStore("dep1", db);
    const project = new ProjectStore("individual", db);
    const now = new Date().toISOString();

    await department.saveProviderAccount(provider(now), "department-secret");
    await department.saveModelDeployment(model(now));
    await department.saveModelRouting(routing(now));

    await project.inheritDepartmentRouting(routingId);

    const inheritedModel = await project.getModelDeployment(modelId);
    expect(inheritedModel).toMatchObject({
      displayName: "Department Chat",
      origin: {
        scope: "DEPARTMENT",
        inherited: true,
        editable: false,
      },
    });
    await expect(project.getModelProviderAccountCredential(inheritedModel!))
      .resolves.toBe("department-secret");
    expect(await project.getModelRouting(routingId)).toMatchObject({
      description: "Shared Department route",
      origin: {
        scope: "DEPARTMENT",
        inherited: true,
        editable: false,
      },
    });

    await department.saveModelDeployment(model(now, "Department Chat v2"));
    await department.saveModelRouting(routing(now, "Updated centrally"));

    expect((await project.getModelDeployment(modelId))?.displayName).toBe(
      "Department Chat v2",
    );
    expect((await project.getModelRouting(routingId))?.description).toBe(
      "Updated centrally",
    );
    await department.saveModelDeployment({
      ...model(now, "Department Chat Next"),
      id: replacementModelId,
      modelId: "department-chat-next",
      litellmModelName: "department-chat-next",
    });
    await department.saveModelRouting({
      ...routing(now, "Updated model centrally"),
      routingPolicy: {
        version: 1,
        mode: "SINGLE",
        modelDeploymentId: replacementModelId,
        fallbackModelDeploymentIds: [],
        retries: 2,
      },
    });
    expect((await project.getModelRouting(routingId))?.routingPolicy).toMatchObject({
      modelDeploymentId: replacementModelId,
    });
    expect(await project.getModelDeployment(replacementModelId)).toMatchObject({
      displayName: "Department Chat Next",
      origin: { inherited: true, editable: false },
    });
    expect(await project.getModelDeployment(modelId)).toBeUndefined();
    await expect(
      project.saveModelRouting({
        ...(await project.getModelRouting(routingId))!,
        name: "Project override",
      }),
    ).rejects.toThrow("read-only");
    await expect(department.deleteModelRouting(routingId)).rejects.toThrow(
      "inherited Routing",
    );
  });

  it("lets a Project choose an inherited Routing as its default without changing the Department", async () => {
    const db = createTestPrisma();
    const department = new DepartmentInferenceStore("dep1", db);
    const project = new ProjectStore("individual", db);
    const now = new Date().toISOString();

    await department.saveProviderAccount(provider(now), "department-secret");
    await department.saveModelDeployment(model(now));
    await department.saveModelRouting(routing(now));
    const inherited = await project.inheritDepartmentRouting(routingId);

    await project.saveDefaultModelRouting({ ...inherited, isDefault: true });
    await project.saveModelRoutingRuntime({
      ...(await project.getModelRouting(routingId))!,
      liteLLMTeamId: "team-project-individual",
    });

    expect((await project.getModelRouting(routingId))?.isDefault).toBe(true);
    expect((await project.getModelRouting(routingId))?.liteLLMTeamId).toBe(
      "team-project-individual",
    );
    expect((await department.getModelRouting(routingId))?.isDefault).toBe(false);
    expect((await department.getModelRouting(routingId))?.liteLLMTeamId).toBeUndefined();
  });
});

describe("Department inference assignment", () => {
  it("assigns a live Routing reference and automatically exposes its current Model dependencies", async () => {
    const db = createTestPrisma();
    const department = new DepartmentInferenceStore("dep1", db);
    const assignments = new DepartmentResourceAssignmentService("dep1", db);
    const project = new ProjectStore("individual", db);
    const now = new Date().toISOString();

    await department.saveProviderAccount(provider(now), "department-secret");
    await department.saveModelDeployment(model(now));
    await department.saveModelRouting(routing(now));
    const result = await assignments.assign(
      "ROUTING",
      routingId,
      { projectIds: ["individual"], setAsProjectDefault: true },
      "department-admin",
    );

    expect(result.dependencies).toEqual([{
      id: modelId,
      name: "Department Chat",
      modelType: "llm",
    }]);
    expect(result.projects.find(({ projectId }) => projectId === "individual"))
      .toMatchObject({
        departmentAssigned: true,
        projectInherited: false,
        isProjectDefault: true,
        defaultManagedBy: "DEPARTMENT",
      });
    expect(await project.getModelRouting(routingId)).toMatchObject({
      isDefault: true,
      origin: {
        accessSources: ["DEPARTMENT_ASSIGNMENT"],
        projectDefault: { slot: "ROUTING", managedBy: "DEPARTMENT" },
      },
    });
    expect(await project.getModelDeployment(modelId)).toMatchObject({
      origin: {
        accessSources: ["ROUTING_DEPENDENCY"],
        routingDependencyIds: [routingId],
      },
    });

    await department.saveModelDeployment({
      ...model(now, "Department Chat Next"),
      id: replacementModelId,
      modelId: "department-chat-next",
      litellmModelName: "department-chat-next",
    });
    await department.saveModelRouting({
      ...routing(now, "Changed centrally"),
      routingPolicy: {
        version: 1,
        mode: "SINGLE",
        modelDeploymentId: replacementModelId,
        fallbackModelDeploymentIds: [],
        retries: 2,
      },
    });

    expect((await project.getModelRouting(routingId))?.description).toBe("Changed centrally");
    expect(await project.getModelDeployment(modelId)).toBeUndefined();
    expect(await project.getModelDeployment(replacementModelId)).toMatchObject({
      displayName: "Department Chat Next",
      origin: { routingDependencyIds: [routingId] },
    });
  });

  it("keeps Department assignment and Project inheritance as independent access sources", async () => {
    const db = createTestPrisma();
    const department = new DepartmentInferenceStore("dep1", db);
    const assignments = new DepartmentResourceAssignmentService("dep1", db);
    const project = new ProjectStore("individual", db);
    const now = new Date().toISOString();

    await department.saveProviderAccount(provider(now), "department-secret");
    await department.saveModelDeployment(model(now));
    await assignments.assign(
      "MODEL",
      modelId,
      { projectIds: ["individual"], setAsProjectDefault: true },
      "department-admin",
    );
    await department.saveModelDeployment(model(now, "Department Chat live update"));
    expect((await project.getModelDeployment(modelId))?.displayName).toBe(
      "Department Chat live update",
    );
    await project.inheritDepartmentModel(modelId, "project-admin");
    expect((await project.getModelDeployment(modelId))?.origin?.accessSources).toEqual([
      "PROJECT_INHERITANCE",
      "DEPARTMENT_ASSIGNMENT",
    ]);

    await assignments.unassign("MODEL", modelId, "individual");
    expect((await project.getModelDeployment(modelId))?.origin?.accessSources).toEqual([
      "PROJECT_INHERITANCE",
    ]);

    await assignments.assign(
      "MODEL",
      modelId,
      { projectIds: ["individual"], setAsProjectDefault: false },
      "department-admin",
    );
    await project.removeDepartmentModelInheritance(modelId);
    expect((await project.getModelDeployment(modelId))?.origin?.accessSources).toEqual([
      "DEPARTMENT_ASSIGNMENT",
    ]);
  });

  it("blocks removing the last inherited or assigned embedding model while Durable Memory depends on it", async () => {
    const db = createTestPrisma();
    const department = new DepartmentInferenceStore("dep1", db);
    const assignments = new DepartmentResourceAssignmentService("dep1", db);
    const project = new ProjectStore("individual", db);
    const now = new Date().toISOString();

    await department.saveProviderAccount(provider(now), "department-secret");
    await department.saveModelDeployment(embeddingModel(now));
    await assignments.assign(
      "MODEL",
      modelId,
      { projectIds: ["individual"], setAsProjectDefault: true },
      "department-admin",
    );
    await db.memoryRecord.create({
      data: {
        projectId: "individual",
        id: "66666666-6666-4666-8666-666666666666",
        displayName: "Inherited embedding memory",
        status: "ready",
      },
    });

    await expect(assignments.unassign("MODEL", modelId, "individual"))
      .rejects.toThrow("1 Durable Memory");

    await project.inheritDepartmentModel(modelId, "project-admin");
    await expect(assignments.unassign("MODEL", modelId, "individual"))
      .resolves.toBeUndefined();
    await expect(project.removeDepartmentModelInheritance(modelId))
      .rejects.toThrow("1 Durable Memory");
  });

  it("blocks removing a Department Routing when it is the Project's only embedding source", async () => {
    const db = createTestPrisma();
    const department = new DepartmentInferenceStore("dep1", db);
    const assignments = new DepartmentResourceAssignmentService("dep1", db);
    const now = new Date().toISOString();

    await department.saveProviderAccount(provider(now), "department-secret");
    await department.saveModelDeployment(embeddingModel(now));
    await department.saveModelRouting(routing(now, "Embedding route"));
    await assignments.assign(
      "ROUTING",
      routingId,
      { projectIds: ["individual"], setAsProjectDefault: false },
      "department-admin",
    );
    await db.memoryRecord.create({
      data: {
        projectId: "individual",
        id: "77777777-7777-4777-8777-777777777777",
        displayName: "Routing embedding memory",
        status: "ready",
      },
    });

    await expect(assignments.unassign("ROUTING", routingId, "individual"))
      .rejects.toThrow("1 Durable Memory");
  });

  it("does not let a Project override a Department-managed Routing default", async () => {
    const db = createTestPrisma();
    const department = new DepartmentInferenceStore("dep1", db);
    const assignments = new DepartmentResourceAssignmentService("dep1", db);
    const project = new ProjectStore("individual", db);
    const now = new Date().toISOString();
    const otherRoutingId = "55555555-5555-4555-8555-555555555555";

    await department.saveProviderAccount(provider(now), "department-secret");
    await department.saveModelDeployment(model(now));
    await department.saveModelRouting(routing(now));
    await department.saveModelRouting({
      ...routing(now, "Other route"),
      id: otherRoutingId,
      name: "Other Department route",
    });
    await assignments.assign(
      "ROUTING",
      routingId,
      { projectIds: ["individual"], setAsProjectDefault: true },
      "department-admin",
    );
    const inherited = await project.inheritDepartmentRouting(
      otherRoutingId,
      "project-admin",
    );

    await expect(project.saveDefaultModelRouting({ ...inherited, isDefault: true }))
      .rejects.toThrow("managed by its Department");
    await expect(assignments.unassign("ROUTING", routingId, "individual"))
      .rejects.toThrow("Choose another Department-managed Project default");
  });
});
