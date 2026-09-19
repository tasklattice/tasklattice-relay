import type { ModelDeployment, ProviderModelSelection } from "@tali/contracts";

export function registeredModelIds(
  models: readonly ModelDeployment[],
  accountId: string | undefined,
): Set<string> {
  return new Set(
    models
      .filter((model) => model.providerAccountId === accountId)
      .map((model) => model.modelId),
  );
}

export function filterModels<
  T extends Pick<ProviderModelSelection, "modelId" | "displayName">,
>(models: readonly T[], search: string): T[] {
  const query = search.trim().toLowerCase();
  return models.filter((model) =>
    `${model.displayName} ${model.modelId}`.toLowerCase().includes(query),
  );
}

export function canSelectModel(
  id: string,
  selected: readonly ProviderModelSelection[],
  registered: ReadonlySet<string>,
): boolean {
  const trimmed = id.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 160 &&
    !registered.has(trimmed) &&
    !selected.some((model) => model.modelId === trimmed)
  );
}
