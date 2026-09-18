import { getControlConfig } from "../config/control-config";
import {
  hasValidatedEmbeddingModel,
  type ModelReadinessCandidate,
} from "@tali/contracts";

export interface ProjectModelInventory {
  listModelDeployments(): Promise<ModelReadinessCandidate[]>;
}

/** The master switch always wins, including over a staged rollout allowlist. */
export function durableMemoryEnabledForProject(
  projectId: string,
  configuration: { enabled: boolean; projectAllowlist: string[] } = getControlConfig().memory,
): boolean {
  return configuration.enabled && (!configuration.projectAllowlist.length
    || configuration.projectAllowlist.includes(projectId));
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
  configuration: { enabled: boolean; projectAllowlist: string[] } = getControlConfig().memory,
): Promise<boolean> {
  if (!durableMemoryEnabledForProject(projectId, configuration)) return false;
  return hasValidatedEmbeddingModel(await store.listModelDeployments());
}

export async function assertDurableMemoryAvailableForProject(
  projectId: string,
  store: ProjectModelInventory,
  configuration: { enabled: boolean; projectAllowlist: string[] } = getControlConfig().memory,
): Promise<void> {
  if (!durableMemoryEnabledForProject(projectId, configuration)) {
    throw new DurableMemoryFeatureDisabledError();
  }
  if (!hasValidatedEmbeddingModel(await store.listModelDeployments())) {
    throw new DurableMemoryEmbeddingRequiredError();
  }
}
