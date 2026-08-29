import type {
  AssignDepartmentInferenceResourceInput,
  DepartmentInferenceResourceAssignmentView,
  ModelDeployment,
  ModelRouting,
  ModelType,
} from "@tali/contracts";
import { prisma } from "../db/prisma";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { ProjectStore, routingDeploymentIds } from "../projects/project-store";

type AssignableResourceKind = "MODEL" | "ROUTING";

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function modelDefaultSlot(modelType: ModelType): "CHAT" | "EMBEDDING" | "SPEECH_TO_TEXT" {
  if (modelType === "text-embedding") return "EMBEDDING";
  if (modelType === "speech-to-text") return "SPEECH_TO_TEXT";
  return "CHAT";
}

export class DepartmentResourceAssignmentService {
  constructor(
    readonly departmentId: string,
    private readonly db: PrismaClient = prisma(),
  ) {}

  async list(
    kind: AssignableResourceKind,
    resourceId: string,
  ): Promise<DepartmentInferenceResourceAssignmentView> {
    const resource = await this.requireResource(kind, resourceId);
    const [projects, modelBindings, routingBindings] = await Promise.all([
      this.db.project.findMany({
        where: { departmentId: this.departmentId, deletedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true },
      }),
      kind === "MODEL"
        ? this.db.projectDepartmentModelBinding.findMany({
            where: { departmentId: this.departmentId, resourceId },
            select: {
              projectId: true,
              projectInheritedAt: true,
              departmentAssignedAt: true,
              defaultFor: true,
              defaultManagedBy: true,
            },
          })
        : Promise.resolve([]),
      kind === "ROUTING"
        ? this.db.projectDepartmentRoutingBinding.findMany({
            where: { departmentId: this.departmentId, resourceId },
            select: {
              projectId: true,
              projectInheritedAt: true,
              departmentAssignedAt: true,
              isDefault: true,
              defaultManagedBy: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const bindings = new Map(
      [...modelBindings, ...routingBindings].map((binding) => [binding.projectId, binding]),
    );
    return {
      departmentId: this.departmentId,
      resourceId,
      resourceKind: kind,
      dependencies: await this.dependencies(kind, resource.payload),
      projects: projects.map((project) => {
        const binding = bindings.get(project.id);
        const isDefault = binding
          ? "isDefault" in binding
            ? binding.isDefault
            : Boolean(binding.defaultFor)
          : false;
        return {
          projectId: project.id,
          projectName: project.name,
          projectInherited: Boolean(binding?.projectInheritedAt),
          departmentAssigned: Boolean(binding?.departmentAssignedAt),
          isProjectDefault: isDefault,
          ...(isDefault && binding?.defaultManagedBy
            ? {
                defaultManagedBy: binding.defaultManagedBy as "PROJECT" | "DEPARTMENT",
              }
            : {}),
        };
      }),
    };
  }

  async assign(
    kind: AssignableResourceKind,
    resourceId: string,
    input: AssignDepartmentInferenceResourceInput,
    actor: string,
  ): Promise<DepartmentInferenceResourceAssignmentView> {
    const resource = await this.requireResource(kind, resourceId);
    const projects = await this.db.project.findMany({
      where: {
        id: { in: input.projectIds },
        departmentId: this.departmentId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (projects.length !== input.projectIds.length) {
      throw new Error("Every target Project must be active and belong to this Department.");
    }
    const now = new Date();
    if (kind === "MODEL") {
      const model = resource.payload as unknown as ModelDeployment;
      if (model.status !== "VALIDATED") {
        throw new Error("Only a validated Department Model can be assigned.");
      }
      const collision = await this.db.modelDeploymentRecord.findFirst({
        where: {
          projectId: { in: input.projectIds },
          id: resourceId,
          deletedAt: null,
        },
        select: { projectId: true },
      });
      if (collision) {
        throw new Error(`Project ${collision.projectId} has a local Model with the same ID.`);
      }
      const defaultFor = modelDefaultSlot(model.modelType);
      await this.db.$transaction(async (transaction) => {
        for (const projectId of input.projectIds) {
          if (input.setAsProjectDefault) {
            await transaction.projectDepartmentModelBinding.updateMany({
              where: { projectId, defaultFor },
              data: { defaultFor: null, defaultManagedBy: null },
            });
          }
          await transaction.projectDepartmentModelBinding.upsert({
            where: { projectId_resourceId: { projectId, resourceId } },
            create: {
              projectId,
              departmentId: this.departmentId,
              resourceId,
              departmentAssignedAt: now,
              departmentAssignedBy: actor,
              ...(input.setAsProjectDefault
                ? { defaultFor, defaultManagedBy: "DEPARTMENT" }
                : {}),
            },
            update: {
              departmentAssignedAt: now,
              departmentAssignedBy: actor,
              ...(input.setAsProjectDefault
                ? { defaultFor, defaultManagedBy: "DEPARTMENT" }
                : {}),
            },
          });
        }
      });
    } else {
      const routing = resource.payload as unknown as ModelRouting;
      if (routing.status !== "READY") {
        throw new Error("Only a READY Department Routing can be assigned.");
      }
      const dependencyIds = [...routingDeploymentIds(routing)];
      const availableDependencies = await this.db.departmentInferenceResourceRecord.findMany({
        where: {
          departmentId: this.departmentId,
          id: { in: dependencyIds },
          kind: "MODEL",
          deletedAt: null,
        },
        select: { id: true },
      });
      if (availableDependencies.length !== dependencyIds.length) {
        throw new Error("This Routing references a Department Model that is unavailable.");
      }
      const [routingCollision, modelCollision] = await Promise.all([
        this.db.modelRoutingRecord.findFirst({
          where: {
            projectId: { in: input.projectIds },
            id: resourceId,
            deletedAt: null,
          },
          select: { projectId: true },
        }),
        this.db.modelDeploymentRecord.findFirst({
          where: {
            projectId: { in: input.projectIds },
            id: { in: dependencyIds },
            deletedAt: null,
          },
          select: { projectId: true, id: true },
        }),
      ]);
      if (routingCollision) {
        throw new Error(`Project ${routingCollision.projectId} has a local Routing with the same ID.`);
      }
      if (modelCollision) {
        throw new Error(
          `Project ${modelCollision.projectId} has a local Model (${modelCollision.id}) that conflicts with this Routing.`,
        );
      }
      await this.db.$transaction(async (transaction) => {
        for (const projectId of input.projectIds) {
          if (input.setAsProjectDefault) {
            const localRoutings = await transaction.modelRoutingRecord.findMany({
              where: { projectId, deletedAt: null },
              select: { id: true, payload: true },
            });
            for (const row of localRoutings) {
              const local = row.payload as unknown as ModelRouting;
              if (!local.isDefault) continue;
              await transaction.modelRoutingRecord.update({
                where: { projectId_id: { projectId, id: row.id } },
                data: {
                  payload: jsonInput({
                    ...local,
                    isDefault: false,
                    updatedAt: now.toISOString(),
                  }),
                },
              });
            }
            await transaction.projectDepartmentRoutingBinding.updateMany({
              where: { projectId, isDefault: true },
              data: { isDefault: false, defaultManagedBy: null },
            });
          }
          await transaction.projectDepartmentRoutingBinding.upsert({
            where: { projectId_resourceId: { projectId, resourceId } },
            create: {
              projectId,
              departmentId: this.departmentId,
              resourceId,
              departmentAssignedAt: now,
              departmentAssignedBy: actor,
              ...(input.setAsProjectDefault
                ? { isDefault: true, defaultManagedBy: "DEPARTMENT" }
                : {}),
            },
            update: {
              departmentAssignedAt: now,
              departmentAssignedBy: actor,
              ...(input.setAsProjectDefault
                ? { isDefault: true, defaultManagedBy: "DEPARTMENT" }
                : {}),
            },
          });
        }
      });
    }
    return this.list(kind, resourceId);
  }

  async unassign(
    kind: AssignableResourceKind,
    resourceId: string,
    projectId: string,
  ): Promise<void> {
    await this.requireProject(projectId);
    if (kind === "MODEL") {
      const binding = await this.db.projectDepartmentModelBinding.findUnique({
        where: { projectId_resourceId: { projectId, resourceId } },
        select: {
          projectInheritedAt: true,
          departmentAssignedAt: true,
          defaultManagedBy: true,
        },
      });
      if (!binding?.departmentAssignedAt) throw new Error("Department Model assignment not found.");
      if (!binding.projectInheritedAt) {
        const remainsViaRouting = await this.modelIsRequiredByAssignedOrInheritedRouting(
          projectId,
          resourceId,
        );
        const projectStore = new ProjectStore(projectId, this.db);
        if (!remainsViaRouting) {
          await projectStore.assertCanRemoveEmbeddingModels([resourceId]);
        }
        if (
          !remainsViaRouting
          && (await projectStore
            .listAgentIdsUsingModelDeployments([resourceId])).length
        ) {
          throw new Error("Reassign Instances using this Model before removing its assignment.");
        }
      }
      if (binding.projectInheritedAt) {
        await this.db.projectDepartmentModelBinding.update({
          where: { projectId_resourceId: { projectId, resourceId } },
          data: {
            departmentAssignedAt: null,
            departmentAssignedBy: null,
            ...(binding.defaultManagedBy === "DEPARTMENT"
              ? { defaultFor: null, defaultManagedBy: null }
              : {}),
          },
        });
      } else {
        await this.db.projectDepartmentModelBinding.delete({
          where: { projectId_resourceId: { projectId, resourceId } },
        });
      }
      return;
    }

    const binding = await this.db.projectDepartmentRoutingBinding.findUnique({
      where: { projectId_resourceId: { projectId, resourceId } },
      select: {
        projectInheritedAt: true,
        departmentAssignedAt: true,
        isDefault: true,
        defaultManagedBy: true,
      },
    });
    if (!binding?.departmentAssignedAt) throw new Error("Department Routing assignment not found.");
    if (binding.isDefault && binding.defaultManagedBy === "DEPARTMENT") {
      throw new Error(
        "Choose another Department-managed Project default before removing this Routing assignment.",
      );
    }
    if (binding.isDefault && !binding.projectInheritedAt) {
      throw new Error(
        "Choose another Project default before removing this Routing assignment.",
      );
    }
    if (!binding.projectInheritedAt) {
      const projectStore = new ProjectStore(projectId, this.db);
      await projectStore.assertCanRemoveEmbeddingModels(
        await projectStore.departmentRoutingModelIdsLostAfterRemoving(resourceId),
      );
      const consumers = (await projectStore
        .listModelRoutingBindings(resourceId))
        .filter((consumer) => !consumer.revokedAt);
      if (consumers.length) {
        throw new Error("Reassign all Instances before removing this Routing assignment.");
      }
      await this.db.projectDepartmentRoutingBinding.delete({
        where: { projectId_resourceId: { projectId, resourceId } },
      });
      return;
    }
    await this.db.projectDepartmentRoutingBinding.update({
      where: { projectId_resourceId: { projectId, resourceId } },
      data: { departmentAssignedAt: null, departmentAssignedBy: null },
    });
  }

  private async requireProject(projectId: string): Promise<void> {
    const project = await this.db.project.findFirst({
      where: { id: projectId, departmentId: this.departmentId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new Error("Project not found in this Department.");
  }

  private async requireResource(kind: AssignableResourceKind, resourceId: string) {
    const resource = await this.db.departmentInferenceResourceRecord.findFirst({
      where: {
        departmentId: this.departmentId,
        id: resourceId,
        kind,
        deletedAt: null,
      },
      select: { payload: true },
    });
    if (!resource) throw new Error(`Department ${kind === "MODEL" ? "Model" : "Routing"} not found.`);
    return resource;
  }

  private async dependencies(
    kind: AssignableResourceKind,
    payload: Prisma.JsonValue,
  ): Promise<DepartmentInferenceResourceAssignmentView["dependencies"]> {
    if (kind === "MODEL") return [];
    const ids = [...routingDeploymentIds(payload as unknown as ModelRouting)];
    const resources = await this.db.departmentInferenceResourceRecord.findMany({
      where: {
        departmentId: this.departmentId,
        id: { in: ids },
        kind: "MODEL",
        deletedAt: null,
      },
      select: { id: true, payload: true },
    });
    const byId = new Map(resources.map((resource) => [resource.id, resource.payload]));
    return ids.flatMap((id) => {
      const model = byId.get(id) as unknown as ModelDeployment | undefined;
      return model ? [{ id, name: model.displayName, modelType: model.modelType }] : [];
    });
  }

  private async modelIsRequiredByAssignedOrInheritedRouting(
    projectId: string,
    modelId: string,
  ): Promise<boolean> {
    const routings = await this.db.projectDepartmentRoutingBinding.findMany({
      where: {
        projectId,
        resource: { kind: "ROUTING", deletedAt: null },
      },
      select: { resource: { select: { payload: true } } },
    });
    return routings.some((binding) =>
      routingDeploymentIds(binding.resource.payload as unknown as ModelRouting).has(modelId),
    );
  }
}
