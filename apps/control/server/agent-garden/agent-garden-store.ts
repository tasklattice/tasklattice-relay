import {
  agentGardenEntrySchema,
  a2aAgentInstanceSchema,
  type A2aAgentInstance,
  type AgentGardenEntry,
} from "@tali/contracts";
import { prisma } from "../db/prisma";
import type { Prisma, PrismaClient } from "../generated/prisma/client";

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function managedInstancePayload(
  instance: A2aAgentInstance,
): Prisma.InputJsonValue {
  const { createdBy: _createdBy, ...payload } = instance;
  return jsonInput(payload);
}

function managedInstanceCreator(user: {
  id: string;
  displayName: string;
  username: string | null;
}): NonNullable<A2aAgentInstance["createdBy"]> {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username ?? user.displayName,
  };
}

export class AgentGardenStore {
  constructor(
    readonly projectId = "individual",
    private readonly db: PrismaClient = prisma(),
  ) {}

  database(): PrismaClient {
    return this.db;
  }

  async saveAgent(
    agent: AgentGardenEntry,
    ownerUserId?: string,
  ): Promise<AgentGardenEntry> {
    const parsed = agentGardenEntrySchema.parse(agent);
    const timestamps = {
      createdAt: parsed.createdAt ? new Date(parsed.createdAt) : new Date(),
      updatedAt: parsed.updatedAt ? new Date(parsed.updatedAt) : new Date(),
    };
    if (!ownerUserId) {
      const updated = await this.db.agentCatalogRecord.updateMany({
        where: { projectId: this.projectId, id: parsed.id },
        data: {
          payload: jsonInput(parsed),
          updatedAt: timestamps.updatedAt,
        },
      });
      if (updated.count) return parsed;
      if (parsed.source !== "BUILT_IN") {
        throw new Error("An owner user is required when creating an Agent Garden entry.");
      }
    }
    await this.db.agentCatalogRecord.upsert({
      where: {
        projectId_id: {
          projectId: this.projectId,
          id: parsed.id,
        },
      },
      create: {
        projectId: this.projectId,
        id: parsed.id,
        payload: jsonInput(parsed),
        ...(ownerUserId ? { ownerUserId } : {}),
        ...timestamps,
      },
      update: {
        payload: jsonInput(parsed),
        updatedAt: timestamps.updatedAt,
      },
    });
    return parsed;
  }

  async ensureAgents(agents: AgentGardenEntry[]): Promise<number> {
    if (!agents.length) return 0;
    const rows = await this.db.agentCatalogRecord.findMany({
      where: {
        projectId: this.projectId,
        deletedAt: null,
        id: { in: agents.map((agent) => agent.id) },
      },
      select: { id: true, payload: true },
    });
    const existing = new Map(
      rows.map((row) => [
        row.id,
        catalogVersion(row.payload),
      ]),
    );
    let saved = 0;
    for (const agent of agents) {
      if (existing.get(agent.id) === agent.configuration.catalogVersion) {
        continue;
      }
      await this.saveAgent(agent);
      saved += 1;
    }
    return saved;
  }

  async getAgent(id: string): Promise<AgentGardenEntry | undefined> {
    const row = await this.db.agentCatalogRecord.findFirst({
      where: { projectId: this.projectId, id, deletedAt: null },
      select: { payload: true },
    });
    return row ? agentGardenEntrySchema.parse(row.payload) : undefined;
  }

  async ownerUserId(id: string): Promise<string | undefined> {
    const row = await this.db.agentCatalogRecord.findFirst({
      where: { projectId: this.projectId, id, deletedAt: null },
      select: { ownerUserId: true },
    });
    return row?.ownerUserId ?? undefined;
  }

  async listAgents(ownerUserId?: string): Promise<AgentGardenEntry[]> {
    const rows = await this.db.agentCatalogRecord.findMany({
      where: {
        projectId: this.projectId,
        deletedAt: null,
        ...(ownerUserId ? { ownerUserId } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: { payload: true },
    });
    return rows.map((row) => agentGardenEntrySchema.parse(row.payload));
  }

  async deleteAgent(id: string): Promise<boolean> {
    const result = await this.db.agentCatalogRecord.updateMany({
      where: { projectId: this.projectId, id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }

  async saveManagedInstance(
    instance: A2aAgentInstance,
    ownerUserId?: string,
  ): Promise<A2aAgentInstance> {
    const parsed = a2aAgentInstanceSchema.parse(instance);
    if (!ownerUserId) {
      const updated = await this.db.agentRecord.updateMany({
        where: {
          projectId: this.projectId,
          id: parsed.id,
          kind: "A2A",
        },
        data: {
          payload: managedInstancePayload(parsed),
          updatedAt: new Date(parsed.updatedAt),
        },
      });
      if (!updated.count) {
        throw new Error(
          "An owner user is required when creating a managed A2A Instance.",
        );
      }
      return parsed;
    }
    const existing = await this.db.agentRecord.findUnique({
      where: {
        projectId_id: { projectId: this.projectId, id: parsed.id },
      },
      select: { kind: true },
    });
    if (existing && existing.kind !== "A2A") {
      throw new Error(
        "Agent Instance identifier belongs to a Supervisor runtime.",
      );
    }
    await this.db.agentRecord.upsert({
      where: {
        projectId_id: { projectId: this.projectId, id: parsed.id },
      },
      create: {
        projectId: this.projectId,
        id: parsed.id,
        kind: "A2A",
        catalogAgentId: parsed.agentId,
        ownerUserId,
        createdByUserId: ownerUserId,
        payload: managedInstancePayload(parsed),
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
      },
      update: {
        kind: "A2A",
        catalogAgentId: parsed.agentId,
        payload: managedInstancePayload(parsed),
        updatedAt: new Date(parsed.updatedAt),
      },
    });
    return parsed;
  }

  async getManagedInstanceForAgent(
    agentId: string,
  ): Promise<A2aAgentInstance | undefined> {
    const row = await this.db.agentRecord.findFirst({
      where: {
        projectId: this.projectId,
        kind: "A2A",
        catalogAgentId: agentId,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: {
        payload: true,
        ownerMembership: {
          select: {
            user: {
              select: { id: true, displayName: true, username: true },
            },
          },
        },
        creatorMembership: {
          select: {
            user: {
              select: { id: true, displayName: true, username: true },
            },
          },
        },
      },
    });
    return row
      ? a2aAgentInstanceSchema.parse({
          ...(row.payload as object),
          createdBy: managedInstanceCreator(
            row.creatorMembership?.user ?? row.ownerMembership.user,
          ),
        })
      : undefined;
  }

  async getManagedInstance(
    id: string,
  ): Promise<A2aAgentInstance | undefined> {
    const row = await this.db.agentRecord.findFirst({
      where: {
        projectId: this.projectId,
        id,
        kind: "A2A",
        deletedAt: null,
      },
      select: {
        payload: true,
        ownerMembership: {
          select: {
            user: {
              select: { id: true, displayName: true, username: true },
            },
          },
        },
        creatorMembership: {
          select: {
            user: {
              select: { id: true, displayName: true, username: true },
            },
          },
        },
      },
    });
    return row
      ? a2aAgentInstanceSchema.parse({
          ...(row.payload as object),
          createdBy: managedInstanceCreator(
            row.creatorMembership?.user ?? row.ownerMembership.user,
          ),
        })
      : undefined;
  }

  async listManagedInstances(
    ownerUserId?: string,
  ): Promise<A2aAgentInstance[]> {
    const rows = await this.db.agentRecord.findMany({
      where: {
        projectId: this.projectId,
        kind: "A2A",
        deletedAt: null,
        ...(ownerUserId ? { ownerUserId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        payload: true,
        ownerMembership: {
          select: {
            user: {
              select: { id: true, displayName: true, username: true },
            },
          },
        },
        creatorMembership: {
          select: {
            user: {
              select: { id: true, displayName: true, username: true },
            },
          },
        },
      },
    });
    return rows.map((row) => a2aAgentInstanceSchema.parse({
      ...(row.payload as object),
      createdBy: managedInstanceCreator(
        row.creatorMembership?.user ?? row.ownerMembership.user,
      ),
    }));
  }

  async deleteManagedInstanceForAgent(agentId: string): Promise<boolean> {
    const result = await this.db.agentRecord.updateMany({
      where: {
        projectId: this.projectId,
        kind: "A2A",
        catalogAgentId: agentId,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }

  async deleteManagedInstance(id: string): Promise<boolean> {
    const result = await this.db.agentRecord.updateMany({
      where: {
        projectId: this.projectId,
        id,
        kind: "A2A",
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }

}

function catalogVersion(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const configuration = (payload as Record<string, unknown>).configuration;
  if (
    !configuration
    || typeof configuration !== "object"
    || Array.isArray(configuration)
  ) {
    return undefined;
  }
  const version = (configuration as Record<string, unknown>).catalogVersion;
  return typeof version === "string" ? version : undefined;
}
