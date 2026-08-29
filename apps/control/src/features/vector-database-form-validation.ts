import {
  createVectorDatabaseDefinitionSchema,
  type CreateVectorDatabaseDefinitionInput,
} from "@tali/contracts";

export const vectorDatabaseFormFields = [
  "name",
  "description",
  "vectorStoreId",
  "topK",
  "embeddingModelDeploymentId",
  "apiBase",
  "credentialReference",
  "semanticField",
  "contentField",
] as const;

export type VectorDatabaseFormField = (typeof vectorDatabaseFormFields)[number];

const vectorDatabaseFormFieldSet = new Set<string>(vectorDatabaseFormFields);
const issueFieldAliases: Record<string, VectorDatabaseFormField> = {
  embeddingDimensions: "embeddingModelDeploymentId",
  embeddingModel: "embeddingModelDeploymentId",
};

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeVectorDatabaseDraft(
  draft: CreateVectorDatabaseDefinitionInput,
): CreateVectorDatabaseDefinitionInput {
  const builtInPostgreSql = draft.provider === "postgresql";
  const elasticsearch = draft.provider === "elasticsearch";

  return {
    ...draft,
    apiBase: builtInPostgreSql ? undefined : optionalTrimmed(draft.apiBase),
    credentialReference: builtInPostgreSql ? "" : draft.credentialReference,
    embeddingModelDeploymentId: builtInPostgreSql
      ? draft.embeddingModelDeploymentId
      : undefined,
    embeddingModel: builtInPostgreSql
      ? optionalTrimmed(draft.embeddingModel)
      : undefined,
    embeddingDimensions: builtInPostgreSql ? draft.embeddingDimensions : undefined,
    semanticField: elasticsearch ? optionalTrimmed(draft.semanticField) : undefined,
    contentField: elasticsearch ? optionalTrimmed(draft.contentField) : undefined,
  };
}

export function validateVectorDatabaseDraft(draft: CreateVectorDatabaseDefinitionInput) {
  const result = createVectorDatabaseDefinitionSchema.safeParse(
    normalizeVectorDatabaseDraft(draft),
  );
  const fieldErrors: Partial<Record<VectorDatabaseFormField, string>> = {};
  const formErrors: string[] = [];

  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = typeof issue.path[0] === "string" ? issue.path[0] : "";
      const field = issueFieldAliases[path]
        ?? (vectorDatabaseFormFieldSet.has(path) ? path as VectorDatabaseFormField : undefined);

      if (field) {
        fieldErrors[field] ??= issue.message;
      } else {
        formErrors.push(issue.message);
      }
    }
  }

  return {
    result,
    fieldErrors,
    formError: formErrors[0] ?? "",
  };
}
