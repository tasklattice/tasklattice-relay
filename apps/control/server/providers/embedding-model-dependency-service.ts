import type {
  Instance,
  KnowledgeSourceDefinition,
  ModelDeployment,
} from "@tali/contracts";
import type { PrismaClient } from "../generated/prisma/client";

export type EmbeddingModelDependencyKind =
  | "DURABLE_MEMORY"
  | "INSTANCE"
  | "VECTOR_DATABASE";

export interface EmbeddingModelDependency {
  direct: boolean;
  id: string;
  kind: EmbeddingModelDependencyKind;
  name: string;
}

export interface EmbeddingModelRemovalImpact {
  dependencies: EmbeddingModelDependency[];
  remainingValidatedEmbeddingModels: number;
  removesValidatedEmbeddingCapability: boolean;
}

interface EmbeddingDependencyStore {
  database(): PrismaClient;
  list(): Promise<Instance[]>;
  listKnowledgeSourceDefinitions(): Promise<KnowledgeSourceDefinition[]>;
  listModelDeployments(): Promise<ModelDeployment[]>;
  projectId: string;
}

export class EmbeddingModelDependencyConflictError extends Error {
  readonly code = "embedding_model_dependency_conflict";
  readonly status = 409;

  constructor(
    readonly impact: EmbeddingModelRemovalImpact,
    modelLabel = "This embedding model",
  ) {
    const counts = dependencyCounts(impact.dependencies);
    const summary = [
      countLabel(counts.DURABLE_MEMORY, "Durable Memory", "Durable Memories"),
      countLabel(counts.VECTOR_DATABASE, "Vector Database", "Vector Databases"),
      countLabel(counts.INSTANCE, "Instance", "Instances"),
    ].filter(Boolean).join(", ");
    super(
      `${modelLabel} cannot be removed because it is required by ${summary}. `
      + "Configure and validate a replacement embedding model, then migrate any direct model bindings before trying again.",
    );
    this.name = "EmbeddingModelDependencyConflictError";
  }
}

export class EmbeddingModelDependencyService {
  constructor(private readonly store: EmbeddingDependencyStore) {}

  async removalImpact(
    removedModelIds: readonly string[],
  ): Promise<EmbeddingModelRemovalImpact> {
    const removed = new Set(removedModelIds);
    const models = await this.store.listModelDeployments();
    const removesValidatedEmbeddingCapability = models.some((model) =>
      removed.has(model.id)
      && model.modelType === "text-embedding"
      && model.status === "VALIDATED");
    if (!removesValidatedEmbeddingCapability) {
      return {
        dependencies: [],
        remainingValidatedEmbeddingModels: models.filter(validatedEmbedding).length,
        removesValidatedEmbeddingCapability: false,
      };
    }

    const remainingValidatedEmbeddingModels = models.filter((model) =>
      !removed.has(model.id) && validatedEmbedding(model)).length;
    const [agents, vectorDatabases] = await Promise.all([
      this.store.list(),
      this.store.listKnowledgeSourceDefinitions(),
    ]);
    const dependencies = new Map<string, EmbeddingModelDependency>();

    for (const database of vectorDatabases) {
      if (
        database.embeddingModelDeploymentId
        && removed.has(database.embeddingModelDeploymentId)
      ) {
        addDependency(dependencies, {
          direct: true,
          id: database.id,
          kind: "VECTOR_DATABASE",
          name: database.name,
        });
      }
    }
    for (const agent of agents) {
      if (
        agent.memory?.mode === "hybrid"
        && removed.has(agent.memory.embeddingModelDeploymentId)
      ) {
        addDependency(dependencies, {
          direct: true,
          id: agent.id,
          kind: "INSTANCE",
          name: agent.name,
        });
      }
    }

    if (remainingValidatedEmbeddingModels === 0) {
      for (const database of vectorDatabases) {
        addDependency(dependencies, {
          direct: Boolean(database.embeddingModelDeploymentId),
          id: database.id,
          kind: "VECTOR_DATABASE",
          name: database.name,
        });
      }
      const memories = await this.store.database().memoryRecord.findMany({
        where: { projectId: this.store.projectId, deletedAt: null },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: { displayName: true, id: true },
      });
      for (const memory of memories) {
        addDependency(dependencies, {
          direct: false,
          id: memory.id,
          kind: "DURABLE_MEMORY",
          name: memory.displayName,
        });
      }
    }

    return {
      dependencies: [...dependencies.values()],
      remainingValidatedEmbeddingModels,
      removesValidatedEmbeddingCapability,
    };
  }

  async assertCanRemove(
    removedModelIds: readonly string[],
    modelLabel?: string,
  ): Promise<void> {
    const impact = await this.removalImpact(removedModelIds);
    if (impact.dependencies.length) {
      throw new EmbeddingModelDependencyConflictError(impact, modelLabel);
    }
  }
}

function validatedEmbedding(model: ModelDeployment): boolean {
  return model.modelType === "text-embedding" && model.status === "VALIDATED";
}

function addDependency(
  dependencies: Map<string, EmbeddingModelDependency>,
  dependency: EmbeddingModelDependency,
): void {
  const key = `${dependency.kind}:${dependency.id}`;
  const current = dependencies.get(key);
  dependencies.set(key, current?.direct
    ? current
    : { ...dependency, direct: current?.direct || dependency.direct });
}

function dependencyCounts(
  dependencies: readonly EmbeddingModelDependency[],
): Record<EmbeddingModelDependencyKind, number> {
  return dependencies.reduce((counts, dependency) => ({
    ...counts,
    [dependency.kind]: counts[dependency.kind] + 1,
  }), {
    DURABLE_MEMORY: 0,
    INSTANCE: 0,
    VECTOR_DATABASE: 0,
  });
}

function countLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return count ? `${count} ${count === 1 ? singular : plural}` : "";
}
