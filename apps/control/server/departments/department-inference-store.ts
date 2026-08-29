import type {
  InferenceGateway,
  ModelDeployment,
  ModelRouting,
  ModelRoutingAuditEvent,
  ModelRoutingBinding,
  ProviderAccount,
} from "@tali/contracts";
import { prisma } from "../db/prisma";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { ProjectStore, routingDeploymentIds } from "../projects/project-store";

type ResourceKind = "PROVIDER" | "MODEL" | "GATEWAY" | "ROUTING";

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function decode<T>(value: Prisma.JsonValue): T {
  return value as T;
}

function withoutOrigin<T extends object>(value: T): Omit<T, "origin"> {
  const { origin: _origin, ...resource } = value as T & { origin?: unknown };
  return resource as Omit<T, "origin">;
}

export class DepartmentInferenceStore extends ProjectStore {
  constructor(
    readonly departmentId: string,
    private readonly departmentDb: PrismaClient = prisma(),
  ) {
    super(`department:${departmentId}`, departmentDb);
  }

  private async departmentName(): Promise<string> {
    const department = await this.departmentDb.department.findUnique({
      where: { id: this.departmentId },
      select: { name: true },
    });
    if (!department) throw new Error("Department not found.");
    return department.name;
  }

  private async withOrigin<T extends object>(resource: T): Promise<T> {
    return {
      ...resource,
      origin: {
        scope: "DEPARTMENT",
        scopeId: this.departmentId,
        scopeName: await this.departmentName(),
        inherited: false,
        editable: true,
      },
    } as T;
  }

  private async resource<T extends object>(kind: ResourceKind, id: string): Promise<T | undefined> {
    const row = await this.departmentDb.departmentInferenceResourceRecord.findFirst({
      where: { departmentId: this.departmentId, id, kind, deletedAt: null },
      select: { payload: true },
    });
    return row ? this.withOrigin(decode<T>(row.payload)) : undefined;
  }

  private async resources<T extends object>(kind: ResourceKind): Promise<T[]> {
    const rows = await this.departmentDb.departmentInferenceResourceRecord.findMany({
      where: { departmentId: this.departmentId, kind, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { payload: true },
    });
    return Promise.all(rows.map((row) => this.withOrigin(decode<T>(row.payload))));
  }

  async saveProviderAccount(
    account: ProviderAccount,
    credentialPayload?: string,
  ): Promise<ProviderAccount> {
    const credential = credentialPayload ?? await this.getProviderAccountCredential(account.id);
    if (!credential) throw new Error("An API credential is required for a new Provider Account.");
    const stored = withoutOrigin(account);
    await this.departmentDb.departmentInferenceResourceRecord.upsert({
      where: { departmentId_id: { departmentId: this.departmentId, id: account.id } },
      create: {
        departmentId: this.departmentId,
        id: account.id,
        kind: "PROVIDER",
        payload: jsonInput(stored),
        credentialPayload: credential,
        createdAt: account.createdAt,
      },
      update: {
        kind: "PROVIDER",
        payload: jsonInput(stored),
        credentialPayload: credential,
        deletedAt: null,
      },
    });
    return this.withOrigin(stored);
  }

  getProviderAccount(id: string): Promise<ProviderAccount | undefined> {
    return this.resource("PROVIDER", id);
  }

  listProviderAccounts(): Promise<ProviderAccount[]> {
    return this.resources("PROVIDER");
  }

  async getProviderAccountCredential(id: string): Promise<string | undefined> {
    const row = await this.departmentDb.departmentInferenceResourceRecord.findFirst({
      where: {
        departmentId: this.departmentId,
        id,
        kind: "PROVIDER",
        deletedAt: null,
      },
      select: { credentialPayload: true },
    });
    return row?.credentialPayload ?? undefined;
  }

  async saveModelDeployment(deployment: ModelDeployment): Promise<ModelDeployment> {
    const stored = withoutOrigin(deployment);
    const provider = await this.getProviderAccount(deployment.providerAccountId);
    if (!provider) throw new Error("Provider Account was not found in this Department.");
    await this.departmentDb.departmentInferenceResourceRecord.upsert({
      where: { departmentId_id: { departmentId: this.departmentId, id: deployment.id } },
      create: {
        departmentId: this.departmentId,
        id: deployment.id,
        kind: "MODEL",
        providerAccountId: deployment.providerAccountId,
        payload: jsonInput(stored),
        createdAt: deployment.createdAt,
      },
      update: {
        kind: "MODEL",
        providerAccountId: deployment.providerAccountId,
        payload: jsonInput(stored),
        deletedAt: null,
      },
    });
    return this.withOrigin(stored);
  }

  getModelDeployment(id: string): Promise<ModelDeployment | undefined> {
    return this.resource("MODEL", id);
  }

  async listModelDeployments(providerAccountId?: string): Promise<ModelDeployment[]> {
    const rows = await this.resources<ModelDeployment>("MODEL");
    return providerAccountId
      ? rows.filter((model) => model.providerAccountId === providerAccountId)
      : rows;
  }

  listModelDeploymentsForReporting(providerAccountId?: string): Promise<ModelDeployment[]> {
    return this.listModelDeployments(providerAccountId);
  }

  async listAgentIdsUsingModelDeployments(ids: readonly string[]): Promise<string[]> {
    if (!ids.length) return [];
    const bindings = await this.departmentDb.projectDepartmentModelBinding.findMany({
      where: { departmentId: this.departmentId, resourceId: { in: [...ids] } },
      select: { projectId: true },
    });
    return [...new Set(bindings.map((binding) => binding.projectId))];
  }

  async deleteModelDeployment(id: string): Promise<boolean> {
    const references = await this.departmentDb.projectDepartmentModelBinding.count({
      where: { departmentId: this.departmentId, resourceId: id },
    });
    if (references) {
      throw new Error(`Remove this assigned or inherited Model from ${references} Project${references === 1 ? "" : "s"} first.`);
    }
    const result = await this.departmentDb.departmentInferenceResourceRecord.updateMany({
      where: { departmentId: this.departmentId, id, kind: "MODEL", deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }

  async deleteProviderAccount(id: string): Promise<boolean> {
    const models = await this.listModelDeployments(id);
    if (await this.listAgentIdsUsingModelDeployments(models.map((model) => model.id)).then((items) => items.length)) {
      throw new Error("Remove inherited Models from child Projects before deleting these Provider credentials.");
    }
    const deletedAt = new Date();
    return this.departmentDb.$transaction(async (transaction) => {
      await transaction.departmentInferenceResourceRecord.updateMany({
        where: {
          departmentId: this.departmentId,
          kind: "MODEL",
          providerAccountId: id,
          deletedAt: null,
        },
        data: { deletedAt },
      });
      const result = await transaction.departmentInferenceResourceRecord.updateMany({
        where: {
          departmentId: this.departmentId,
          id,
          kind: "PROVIDER",
          deletedAt: null,
        },
        data: { deletedAt },
      });
      return result.count > 0;
    });
  }

  async saveInferenceGateway(gateway: InferenceGateway): Promise<InferenceGateway> {
    const stored = withoutOrigin(gateway);
    await this.departmentDb.departmentInferenceResourceRecord.upsert({
      where: { departmentId_id: { departmentId: this.departmentId, id: gateway.id } },
      create: {
        departmentId: this.departmentId,
        id: gateway.id,
        kind: "GATEWAY",
        payload: jsonInput(stored),
        createdAt: gateway.createdAt,
      },
      update: { kind: "GATEWAY", payload: jsonInput(stored), deletedAt: null },
    });
    return this.withOrigin(stored);
  }

  getInferenceGateway(id: string): Promise<InferenceGateway | undefined> {
    return this.resource("GATEWAY", id);
  }

  listInferenceGateways(): Promise<InferenceGateway[]> {
    return this.resources("GATEWAY");
  }

  async saveModelRouting(routing: ModelRouting): Promise<ModelRouting> {
    const canonical = withoutOrigin({
      ...routing,
      publicModelAlias: `tali-routing-${routing.id}`,
    });
    const dependencyIds = [...routingDeploymentIds(routing)];
    const dependencies = await this.departmentDb.departmentInferenceResourceRecord.count({
      where: {
        departmentId: this.departmentId,
        id: { in: dependencyIds },
        kind: "MODEL",
        deletedAt: null,
      },
    });
    if (dependencies !== dependencyIds.length) {
      throw new Error("Department Routing references a Model that is unavailable.");
    }
    const boundProjects = await this.departmentDb.projectDepartmentRoutingBinding.findMany({
      where: { departmentId: this.departmentId, resourceId: routing.id },
      select: { projectId: true },
    });
    if (boundProjects.length) {
      const collision = await this.departmentDb.modelDeploymentRecord.findFirst({
        where: {
          projectId: { in: boundProjects.map(({ projectId }) => projectId) },
          id: { in: dependencyIds },
          deletedAt: null,
        },
        select: { projectId: true, id: true },
      });
      if (collision) {
        throw new Error(
          `Project ${collision.projectId} has a local Model (${collision.id}) that conflicts with this Routing update.`,
        );
      }
    }
    await this.departmentDb.departmentInferenceResourceRecord.upsert({
      where: { departmentId_id: { departmentId: this.departmentId, id: routing.id } },
      create: {
        departmentId: this.departmentId,
        id: routing.id,
        kind: "ROUTING",
        payload: jsonInput(canonical),
        createdAt: routing.createdAt,
      },
      update: { kind: "ROUTING", payload: jsonInput(canonical), deletedAt: null },
    });
    return this.withOrigin(canonical);
  }

  saveModelRoutingRuntime(routing: ModelRouting): Promise<ModelRouting> {
    return this.saveModelRouting(routing);
  }

  async saveDefaultModelRouting(routing: ModelRouting): Promise<ModelRouting> {
    const existing = await this.listModelRoutings();
    if (!existing.some((candidate) => candidate.id === routing.id)) {
      throw new Error("Routing not found.");
    }
    const now = routing.updatedAt;
    await Promise.all(existing.map((candidate) => this.saveModelRouting({
      ...candidate,
      isDefault: candidate.id === routing.id,
      updatedAt: candidate.id === routing.id || candidate.isDefault ? now : candidate.updatedAt,
    })));
    return (await this.getModelRouting(routing.id))!;
  }

  getModelRouting(id: string): Promise<ModelRouting | undefined> {
    return this.resource("ROUTING", id);
  }

  listModelRoutings(): Promise<ModelRouting[]> {
    return this.resources("ROUTING");
  }

  async deleteModelRouting(id: string): Promise<boolean> {
    const references = await this.departmentDb.projectDepartmentRoutingBinding.count({
      where: { departmentId: this.departmentId, resourceId: id },
    });
    if (references) {
      throw new Error(`Remove this assigned or inherited Routing from ${references} Project${references === 1 ? "" : "s"} first.`);
    }
    const result = await this.departmentDb.departmentInferenceResourceRecord.updateMany({
      where: { departmentId: this.departmentId, id, kind: "ROUTING", deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }

  async saveModelRoutingBinding(_binding: ModelRoutingBinding): Promise<ModelRoutingBinding> {
    throw new Error("Instances bind Department Routing through a child Project.");
  }

  async getModelRoutingBindingForAgent(_agentId: string): Promise<ModelRoutingBinding | undefined> {
    return undefined;
  }

  async listModelRoutingBindings(modelRoutingId: string): Promise<ModelRoutingBinding[]> {
    const rows = await this.departmentDb.modelRoutingBindingRecord.findMany({
      where: {
        modelRoutingId,
        project: { departmentId: this.departmentId, deletedAt: null },
      },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    return rows.map((row) => decode<ModelRoutingBinding>(row.payload));
  }

  async appendModelRoutingAudit(event: ModelRoutingAuditEvent): Promise<ModelRoutingAuditEvent> {
    await this.departmentDb.departmentModelRoutingAuditRecord.create({
      data: {
        departmentId: this.departmentId,
        eventId: event.eventId,
        modelRoutingId: event.modelRoutingId,
        payload: jsonInput(event),
        createdAt: event.timestamp,
      },
    });
    return event;
  }

  async listModelRoutingAudit(modelRoutingId: string): Promise<ModelRoutingAuditEvent[]> {
    const rows = await this.departmentDb.departmentModelRoutingAuditRecord.findMany({
      where: { departmentId: this.departmentId, modelRoutingId },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    return rows.map((row) => decode<ModelRoutingAuditEvent>(row.payload));
  }
}
