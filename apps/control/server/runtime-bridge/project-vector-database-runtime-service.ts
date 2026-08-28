import {
  hasValidatedEmbeddingModel,
  vectorDatabaseSearchInputSchema,
  type Instance,
  type KnowledgeSourceDefinition,
  type VectorDatabaseSearchInput,
  type VectorDatabaseSearchResult,
} from "@tali/contracts";
import {
  ResourceCatalogService,
  VectorDatabaseEmbeddingRequiredError,
} from "../catalog/resource-catalog-service";
import { ProjectStore } from "../projects/project-store";

export interface ProjectVectorDatabase {
  description: string;
  id: string;
  name: string;
  topK: number;
}

export interface ProjectVectorDatabaseSearchResult {
  durationMs: number;
  query: string;
  results: Array<{
    content: string;
    filename: string;
    id: string;
    pageNumber: number | null;
    score: number;
    sectionPath: string[];
  }>;
}

type RuntimeProjectStore = Pick<
  ProjectStore,
  "get" | "getKnowledgeSourceDefinition" | "listKnowledgeSourceDefinitions" | "listModelDeployments"
>;

type RuntimeVectorCatalog = Pick<ResourceCatalogService, "searchVectorDatabase">;

export class ProjectVectorDatabaseRuntimeService {
  private readonly store: RuntimeProjectStore;
  private readonly catalog: RuntimeVectorCatalog;

  constructor(
    readonly projectId: string,
    dependencies: {
      catalog?: RuntimeVectorCatalog;
      store?: RuntimeProjectStore;
    } = {},
  ) {
    const store = dependencies.store ?? new ProjectStore(projectId);
    this.store = store;
    this.catalog = dependencies.catalog
      ?? new ResourceCatalogService(store as ProjectStore);
  }

  async list(coordinatorInstanceId: string): Promise<ProjectVectorDatabase[]> {
    await this.requireHermesCoordinator(coordinatorInstanceId);
    await this.requireEmbeddingModel();
    return (await this.store.listKnowledgeSourceDefinitions())
      .filter(availableVectorDatabase)
      .map(publicVectorDatabase);
  }

  async search(
    coordinatorInstanceId: string,
    databaseId: string,
    input: VectorDatabaseSearchInput,
  ): Promise<ProjectVectorDatabaseSearchResult> {
    await this.requireHermesCoordinator(coordinatorInstanceId);
    await this.requireEmbeddingModel();
    const database = await this.store.getKnowledgeSourceDefinition(databaseId);
    if (!database || !availableVectorDatabase(database)) {
      throw new Error("Project Vector Database was not found or is unavailable.");
    }
    const result = await this.catalog.searchVectorDatabase(
      database.id,
      vectorDatabaseSearchInputSchema.parse(input),
    );
    return publicSearchResult(result);
  }

  private async requireHermesCoordinator(
    coordinatorInstanceId: string,
  ): Promise<Instance> {
    const coordinator = await this.store.get(coordinatorInstanceId);
    if (!coordinator) throw new Error("Coordinator Instance was not found.");
    if (coordinator.agentPlatform !== "hermes") {
      throw new Error("Vector Database runtime tools are available to Hermes Instances only.");
    }
    return coordinator;
  }

  private async requireEmbeddingModel(): Promise<void> {
    if (!hasValidatedEmbeddingModel(await this.store.listModelDeployments())) {
      throw new VectorDatabaseEmbeddingRequiredError();
    }
  }
}

function availableVectorDatabase(
  database: KnowledgeSourceDefinition,
): boolean {
  return database.status === "REGISTERED";
}

function publicVectorDatabase(
  database: KnowledgeSourceDefinition,
): ProjectVectorDatabase {
  return {
    id: database.id,
    name: database.name,
    description: database.description,
    topK: database.topK,
  };
}

function publicSearchResult(
  result: VectorDatabaseSearchResult,
): ProjectVectorDatabaseSearchResult {
  return {
    query: result.query,
    durationMs: result.durationMs,
    results: result.results.map((item) => ({
      id: item.id,
      content: item.content,
      filename: item.filename,
      score: item.score,
      pageNumber: item.pageNumber,
      sectionPath: item.sectionPath,
    })),
  };
}
