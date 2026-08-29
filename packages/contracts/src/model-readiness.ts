export interface ModelReadinessCandidate {
  modelType: string;
  status: string;
}

/**
 * Project model inventories already include locally registered Models plus
 * Department Models made available through assignment, inheritance, or a
 * Routing dependency. Capability admission should therefore evaluate the
 * effective inventory instead of looking for a Project-owned Provider.
 */
export function hasValidatedEmbeddingModel(
  models: readonly ModelReadinessCandidate[],
): boolean {
  return models.some(
    (model) =>
      model.modelType === "text-embedding" && model.status === "VALIDATED",
  );
}
