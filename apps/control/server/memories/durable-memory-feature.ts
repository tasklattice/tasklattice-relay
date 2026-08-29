import {
  hasValidatedEmbeddingModel,
  type ModelReadinessCandidate,
} from "@tali/contracts";

interface DurableMemoryFeatureEnvironment {
  TALI_DURABLE_MEMORY_ENABLED?: string;
  TALI_DURABLE_MEMORY_PROJECTS?: string;
}

export interface ProjectModelInventory {
  listModelDeployments(): Promise<ModelReadinessCandidate[]>;
}

function enabledByDefault(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "") return true;
  return !new Set(["0", "false", "no", "off"]).has(value.trim().toLowerCase());
}

function projectAllowlist(value: string | undefined): Set<string> | null {
  if (value === undefined || value.trim() === "") return null;
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
}

/**
 * A configured allowlist takes precedence over the environment default so a
 * release can be rolled out Project by Project without changing Project data.
 */
export function durableMemoryEnabledForProject(
  projectId: string,
  environment: DurableMemoryFeatureEnvironment = process.env,
): boolean {
  const allowlist = projectAllowlist(environment.TALI_DURABLE_MEMORY_PROJECTS);
  return allowlist
    ? allowlist.has(projectId)
    : enabledByDefault(environment.TALI_DURABLE_MEMORY_ENABLED);
}

export class DurableMemoryFeatureDisabledError extends Error {
  readonly code = "feature_disabled";
  readonly status = 404;

  constructor() {
    super("Durable Memory is not enabled for this Project.");
    this.name = "DurableMemoryFeatureDisabledError";
  }
}

export class DurableMemoryEmbeddingRequiredError extends Error {
  readonly code = "embedding_model_required";
  readonly status = 409;

  constructor() {
    super(
      "Project Durable Memory requires a validated text embedding model. Register or inherit an embedding model in Project Settings before using Durable Memory.",
    );
    this.name = "DurableMemoryEmbeddingRequiredError";
  }
}

export async function durableMemoryAvailableForProject(
  projectId: string,
  store: ProjectModelInventory,
  environment: DurableMemoryFeatureEnvironment = process.env,
): Promise<boolean> {
  if (!durableMemoryEnabledForProject(projectId, environment)) return false;
  return hasValidatedEmbeddingModel(await store.listModelDeployments());
}

export async function assertDurableMemoryAvailableForProject(
  projectId: string,
  store: ProjectModelInventory,
  environment: DurableMemoryFeatureEnvironment = process.env,
): Promise<void> {
  if (!durableMemoryEnabledForProject(projectId, environment)) {
    throw new DurableMemoryFeatureDisabledError();
  }
  if (!hasValidatedEmbeddingModel(await store.listModelDeployments())) {
    throw new DurableMemoryEmbeddingRequiredError();
  }
}
