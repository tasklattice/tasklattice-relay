import {
  type CreateVectorDatabaseDefinitionInput,
  vectorDatabaseFormLimits,
} from "@tali/contracts";
import { describe, expect, it } from "vitest";
import { validateVectorDatabaseDraft } from "@/features/vector-database-form-validation";

const validPostgreSqlDraft: CreateVectorDatabaseDefinitionInput = {
  credentialReference: "",
  description: "Research documents for Project Agents.",
  embeddingModel: "text-embedding-3-small",
  embeddingModelDeploymentId: "00000000-0000-4000-8000-000000000001",
  name: "Engineering Research",
  provider: "postgresql",
  topK: 8,
  vectorStoreId: "engineering-research",
};

describe("Create Vector Database form validation", () => {
  it("maps every invalid common field to inline feedback", () => {
    const validation = validateVectorDatabaseDraft({
      ...validPostgreSqlDraft,
      description: "too short",
      name: "ab",
      topK: 1.5,
      vectorStoreId: "",
    });

    expect(validation.result.success).toBe(false);
    expect(validation.fieldErrors).toMatchObject({
      name: `Enter at least ${vectorDatabaseFormLimits.name.min} characters.`,
      description: `Enter at least ${vectorDatabaseFormLimits.description.min} characters.`,
      vectorStoreId: "Vector Database ID is required.",
      topK: "Enter a whole number.",
    });
    expect(validation.formError).toBe("");
  });

  it("uses trimmed values and enforces the description boundaries", () => {
    expect(validateVectorDatabaseDraft({
      ...validPostgreSqlDraft,
      description: "  123456789  ",
    }).fieldErrors.description).toBe(
      `Enter at least ${vectorDatabaseFormLimits.description.min} characters.`,
    );
    expect(validateVectorDatabaseDraft({
      ...validPostgreSqlDraft,
      description: "  1234567890  ",
    }).result.success).toBe(true);
    expect(validateVectorDatabaseDraft({
      ...validPostgreSqlDraft,
      description: "a".repeat(vectorDatabaseFormLimits.description.max + 1),
    }).fieldErrors.description).toBe(
      `Use no more than ${vectorDatabaseFormLimits.description.max} characters.`,
    );
  });

  it("requires a validated embedding model for built-in PostgreSQL", () => {
    const validation = validateVectorDatabaseDraft({
      ...validPostgreSqlDraft,
      embeddingModel: undefined,
      embeddingModelDeploymentId: undefined,
    });

    expect(validation.result.success).toBe(false);
    expect(validation.fieldErrors.embeddingModelDeploymentId).toBe(
      "A validated embedding model is required for PostgreSQL vector storage.",
    );
  });

  it("maps PGVector conditional requirements beside their inputs", () => {
    const validation = validateVectorDatabaseDraft({
      ...validPostgreSqlDraft,
      apiBase: "   ",
      credentialReference: "",
      embeddingModel: undefined,
      embeddingModelDeploymentId: undefined,
      provider: "pg_vector",
    });

    expect(validation.result.success).toBe(false);
    expect(validation.fieldErrors).toMatchObject({
      apiBase: "PGVector connector API base is required.",
      credentialReference: "PGVector connector credential is required.",
    });
  });

  it("maps every Elasticsearch conditional requirement beside its input", () => {
    const validation = validateVectorDatabaseDraft({
      ...validPostgreSqlDraft,
      apiBase: undefined,
      contentField: " ",
      credentialReference: "",
      embeddingModel: undefined,
      embeddingModelDeploymentId: undefined,
      provider: "elasticsearch",
      semanticField: undefined,
    });

    expect(validation.result.success).toBe(false);
    expect(validation.fieldErrors).toMatchObject({
      apiBase: "Elasticsearch URL is required.",
      contentField: "Elasticsearch content field is required.",
      credentialReference: "Elasticsearch credential is required.",
      semanticField: "Elasticsearch semantic_text field is required.",
    });
  });

  it("validates URL and Secret reference formats before submission", () => {
    const validation = validateVectorDatabaseDraft({
      ...validPostgreSqlDraft,
      apiBase: "not-a-url",
      credentialReference: "secret://project/vector-provider",
      embeddingModel: undefined,
      embeddingModelDeploymentId: undefined,
      provider: "pg_vector",
    });

    expect(validation.fieldErrors).toMatchObject({
      apiBase: "Enter a valid provider API URL.",
      credentialReference: "Credentials must use a supported Secret reference.",
    });
  });

  it("accepts a complete provider-managed configuration and normalizes whitespace", () => {
    const validation = validateVectorDatabaseDraft({
      ...validPostgreSqlDraft,
      apiBase: "  https://vector.example.com  ",
      contentField: "  content  ",
      credentialReference: "  k8s://project/vector-provider  ",
      embeddingModel: undefined,
      embeddingModelDeploymentId: undefined,
      provider: "elasticsearch",
      semanticField: "  content_semantic  ",
    });

    expect(validation.result.success).toBe(true);
    if (validation.result.success) {
      expect(validation.result.data).toMatchObject({
        apiBase: "https://vector.example.com",
        contentField: "content",
        credentialReference: "k8s://project/vector-provider",
        semanticField: "content_semantic",
      });
    }
  });

  it("does not let hidden provider fields block the active provider", () => {
    const validation = validateVectorDatabaseDraft({
      ...validPostgreSqlDraft,
      apiBase: "not-a-url",
      contentField: "x".repeat(vectorDatabaseFormLimits.providerField.max + 1),
      credentialReference: "secret://unsupported",
      semanticField: "x".repeat(vectorDatabaseFormLimits.providerField.max + 1),
    });

    expect(validation.result.success).toBe(true);
    if (validation.result.success) {
      expect(validation.result.data.apiBase).toBeUndefined();
      expect(validation.result.data.credentialReference).toBe("");
      expect(validation.result.data.semanticField).toBeUndefined();
      expect(validation.result.data.contentField).toBeUndefined();
    }
  });

  it("shows a field error when Top K is blank or outside its range", () => {
    expect(validateVectorDatabaseDraft({
      ...validPostgreSqlDraft,
      topK: Number.NaN,
    }).fieldErrors.topK).toBe("Enter a whole number from 1 to 50.");
    expect(validateVectorDatabaseDraft({
      ...validPostgreSqlDraft,
      topK: vectorDatabaseFormLimits.topK.max + 1,
    }).fieldErrors.topK).toBe(
      `Enter a value no greater than ${vectorDatabaseFormLimits.topK.max}.`,
    );
  });
});
