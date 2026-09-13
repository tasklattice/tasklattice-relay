import type {
  KnowledgeSourceDefinition,
  UpsertKnowledgeVectorChunksInput,
  VectorCustomMetadata,
} from "@tali/contracts";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import type { LiteLLMAdminClient } from "../providers/litellm-client";
import { ProjectStore } from "../projects/project-store";
import {
  type VectorStoreSearchResponse,
  vectorStoreSearchQuery,
  vectorStoreSearchRequestSchema,
} from "./vector-store-protocol";
import type { DoclingParsedChunk } from "./docling-client";

type EmbeddingClient = Pick<Required<LiteLLMAdminClient>, "createEmbeddings">;

interface KnowledgeVectorSearchRow {
  id: string;
  content: string;
  filename: string;
  attributes: Record<string, unknown>;
  score: number;
}

export class KnowledgeVectorDatabase {
  constructor(
    readonly store: ProjectStore,
    readonly embeddings: EmbeddingClient,
    readonly db: PrismaClient = store.database(),
  ) {}

  async provision(source: KnowledgeSourceDefinition): Promise<void> {
    const config = postgresqlSource(source);
    const existing = await this.db.knowledgeVectorDatabase.findUnique({
      where: {
        projectId_id: { projectId: this.store.projectId, id: source.id },
      },
    });
    if (
      existing
      && (existing.embeddingModel !== config.embeddingModel
        || existing.embeddingDimensions !== config.embeddingDimensions)
    ) {
      const chunks = await this.db.knowledgeVectorChunk.count({
        where: { projectId: this.store.projectId, databaseId: source.id },
      });
      if (chunks) {
        throw new Error(
          "The embedding model and dimensions cannot change after PostgreSQL vector chunks are stored.",
        );
      }
    }
    await this.db.knowledgeVectorDatabase.upsert({
      where: {
        projectId_id: { projectId: this.store.projectId, id: source.id },
      },
      create: {
        projectId: this.store.projectId,
        id: source.id,
        vectorStoreId: source.vectorStoreId,
        embeddingModel: config.embeddingModel,
        embeddingDimensions: config.embeddingDimensions,
      },
      update: {
        vectorStoreId: source.vectorStoreId,
        embeddingModel: config.embeddingModel,
        embeddingDimensions: config.embeddingDimensions,
      },
    });
  }

  async drop(sourceId: string): Promise<void> {
    await this.db.knowledgeVectorDatabase.deleteMany({
      where: { projectId: this.store.projectId, id: sourceId },
    });
  }

  async upsertChunks(
    sourceId: string,
    input: UpsertKnowledgeVectorChunksInput,
  ): Promise<{ upserted: number }> {
    const { database, source } = await this.databaseForSource(sourceId);
    const duplicateIds = input.chunks
      .map((chunk) => chunk.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index);
    if (duplicateIds.length) {
      throw new Error(`Chunk IDs must be unique within a batch: ${duplicateIds[0]}.`);
    }
    const vectors = await this.embeddings.createEmbeddings(
      database.embeddingModel,
      input.chunks.map((chunk) => chunk.content),
      "passage",
    );
    if (vectors.length !== input.chunks.length) {
      throw new Error(
        `The embedding model returned ${vectors.length} vectors for ${input.chunks.length} chunks.`,
      );
    }
    const encoded = vectors.map((vector) => vectorLiteral(
      vector,
      database.embeddingDimensions,
    ));
    await this.db.$transaction(async (transaction) => {
      for (const [index, chunk] of input.chunks.entries()) {
        await transaction.$executeRaw`
          INSERT INTO tasklattice.knowledge_vector_chunks (
            project_id,
            database_id,
            id,
            content,
            filename,
            attributes,
            embedding_dimensions,
            embedding,
            created_at,
            updated_at
          ) VALUES (
            ${this.store.projectId},
            ${source.id},
            ${chunk.id},
            ${chunk.content},
            ${chunk.filename ?? `${chunk.id}.txt`},
            ${JSON.stringify(chunk.attributes)}::jsonb,
            ${database.embeddingDimensions},
            ${encoded[index]}::public.vector,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
          ON CONFLICT (project_id, database_id, id) DO UPDATE SET
            content = EXCLUDED.content,
            filename = EXCLUDED.filename,
            attributes = EXCLUDED.attributes,
            embedding_dimensions = EXCLUDED.embedding_dimensions,
            embedding = EXCLUDED.embedding,
            updated_at = CURRENT_TIMESTAMP
        `;
      }
    });
    return { upserted: input.chunks.length };
  }

  async replaceDocumentChunks(
    sourceId: string,
    input: {
      contentHash: string;
      documentId: string;
      directoryPath: string;
      folderId: string | null;
      filename: string;
      customMetadata: VectorCustomMetadata;
      revision: number;
      chunks: DoclingParsedChunk[];
    },
  ): Promise<{ upserted: number }> {
    const { database, source } = await this.databaseForSource(sourceId);
    const vectors: string[] = [];
    for (let start = 0; start < input.chunks.length; start += 64) {
      const batch = input.chunks.slice(start, start + 64);
      const embedded = await this.embeddings.createEmbeddings(
        database.embeddingModel,
        batch.map((chunk) => chunk.content),
        "passage",
      );
      if (embedded.length !== batch.length) {
        throw new Error(
          `The embedding model returned ${embedded.length} vectors for ${batch.length} Docling chunks.`,
        );
      }
      vectors.push(...embedded.map((vector) => vectorLiteral(
        vector,
        database.embeddingDimensions,
      )));
    }

    await this.db.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        DELETE FROM tasklattice.knowledge_vector_chunks
        WHERE project_id = ${this.store.projectId}
          AND database_id = ${source.id}
          AND document_id = ${input.documentId}
          AND document_revision = ${input.revision}
      `;
      for (const [index, chunk] of input.chunks.entries()) {
        const chunkId = `${input.documentId}-r${input.revision}-c${String(index + 1).padStart(5, "0")}`;
        const sectionPath = chunk.sectionPath.length
          ? Prisma.sql`ARRAY[${Prisma.join(chunk.sectionPath)}]::TEXT[]`
          : Prisma.sql`ARRAY[]::TEXT[]`;
        const attributes = {
          ...chunk.attributes,
          content_hash: input.contentHash,
          document_id: input.documentId,
          document_revision: input.revision,
          folder_id: input.folderId ?? "root",
          file_name: input.filename,
          file_path: input.directoryPath === "/"
            ? `/${input.filename}`
            : `${input.directoryPath}/${input.filename}`,
          page_number: chunk.pageNumber,
          chunk_index: index,
          section_path: chunk.sectionPath,
          ...Object.fromEntries(
            Object.entries(input.customMetadata)
              .map(([key, metadata]) => [`tali_metadata_${key}`, metadata.value]),
          ),
        };
        await transaction.$executeRaw(Prisma.sql`
          INSERT INTO tasklattice.knowledge_vector_chunks (
            project_id,
            database_id,
            id,
            content,
            filename,
            attributes,
            document_id,
            document_revision,
            page_number,
            chunk_index,
            token_count,
            section_path,
            label,
            embedding_dimensions,
            embedding,
            created_at,
            updated_at
          ) VALUES (
            ${this.store.projectId},
            ${source.id},
            ${chunkId},
            ${chunk.content},
            ${input.filename},
            ${JSON.stringify(attributes)}::jsonb,
            ${input.documentId},
            ${input.revision},
            ${chunk.pageNumber},
            ${index},
            ${chunk.tokenCount},
            ${sectionPath},
            ${chunk.label},
            ${database.embeddingDimensions},
            ${vectors[index]}::public.vector,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `);
      }
    });
    return { upserted: input.chunks.length };
  }

  async deleteChunk(sourceId: string, chunkId: string): Promise<boolean> {
    const { source } = await this.databaseForSource(sourceId);
    const deleted = await this.db.$executeRaw`
      DELETE FROM tasklattice.knowledge_vector_chunks
      WHERE project_id = ${this.store.projectId}
        AND database_id = ${source.id}
        AND id = ${chunkId}
    `;
    return deleted > 0;
  }

  async deleteDocumentRevisions(
    sourceId: string,
    documentId: string,
    currentContentHash: string,
  ): Promise<number> {
    const { source } = await this.databaseForSource(sourceId);
    return this.db.$executeRaw`
      DELETE FROM tasklattice.knowledge_vector_chunks
      WHERE project_id = ${this.store.projectId}
        AND database_id = ${source.id}
        AND attributes @> ${JSON.stringify({ document_id: documentId })}::jsonb
        AND NOT (attributes @> ${JSON.stringify({ content_hash: currentContentHash })}::jsonb)
    `;
  }

  async search(vectorStoreId: string, input: unknown): Promise<VectorStoreSearchResponse> {
    const request = vectorStoreSearchRequestSchema.parse(input);
    const query = vectorStoreSearchQuery(request);
    const source = (await this.store.listKnowledgeSourceDefinitions())
      .find((candidate) => candidate.vectorStoreId === vectorStoreId);
    if (!source || source.provider !== "postgresql") {
      throw new Error("Built-in PostgreSQL Vector Database was not found.");
    }
    const database = await this.db.knowledgeVectorDatabase.findUnique({
      where: {
        projectId_id: { projectId: this.store.projectId, id: source.id },
      },
    });
    if (!database) {
      throw new Error("Built-in PostgreSQL Vector Database is not provisioned.");
    }
    const [embedding] = await this.embeddings.createEmbeddings(
      database.embeddingModel,
      [query],
      "query",
    );
    if (!embedding) throw new Error("The embedding model returned no query vector.");
    const encoded = vectorLiteral(embedding, database.embeddingDimensions);
    const filter = request.filters
      ? Prisma.sql`AND (${translateFilter(request.filters)})`
      : Prisma.empty;
    const limit = request.max_num_results ?? source.topK;
    const rows = await this.db.$queryRaw<KnowledgeVectorSearchRow[]>(Prisma.sql`
      SELECT
        chunk.id,
        chunk.content,
        chunk.filename,
        chunk.attributes || jsonb_build_object('chunk_index', chunk.chunk_index) AS attributes,
        1 - (chunk.embedding <=> ${encoded}::public.vector) AS score
      FROM tasklattice.knowledge_vector_chunks AS chunk
      WHERE chunk.project_id = ${this.store.projectId}
        AND chunk.database_id = ${source.id}
        AND (
          chunk.document_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM tasklattice.vector_documents AS document
            WHERE document.project_id = chunk.project_id
              AND document.database_id = chunk.database_id
              AND document.id = chunk.document_id
              AND document.active_revision = chunk.document_revision
          )
        )
        ${filter}
      ORDER BY chunk.embedding <=> ${encoded}::public.vector
      LIMIT ${limit}
    `);
    return {
      object: "vector_store.search_results.page",
      search_query: query,
      data: rows.map((row) => ({
        score: Number(row.score),
        content: [{ type: "text", text: row.content }],
        file_id: row.id,
        filename: row.filename,
        attributes: row.attributes,
      })),
    };
  }

  private async databaseForSource(sourceId: string) {
    const source = await this.store.getKnowledgeSourceDefinition(sourceId);
    if (!source || source.provider !== "postgresql") {
      throw new Error("Built-in PostgreSQL Vector Database was not found.");
    }
    const database = await this.db.knowledgeVectorDatabase.findUnique({
      where: {
        projectId_id: { projectId: this.store.projectId, id: source.id },
      },
    });
    if (!database) {
      throw new Error("Built-in PostgreSQL Vector Database is not provisioned.");
    }
    return { database, source };
  }
}

function postgresqlSource(source: KnowledgeSourceDefinition): {
  embeddingModel: string;
  embeddingDimensions: number;
} {
  if (
    source.provider !== "postgresql"
    || !source.embeddingModel
    || !source.embeddingDimensions
  ) {
    throw new Error("PostgreSQL vector storage requires an embedding model and dimensions.");
  }
  return {
    embeddingModel: source.embeddingModel,
    embeddingDimensions: source.embeddingDimensions,
  };
}

function vectorLiteral(vector: number[], expectedDimensions: number): string {
  if (vector.length !== expectedDimensions) {
    throw new Error(
      `Embedding dimension mismatch: expected ${expectedDimensions}, received ${vector.length}.`,
    );
  }
  if (!vector.every(Number.isFinite)) {
    throw new Error("Embeddings must contain only finite numbers.");
  }
  return `[${vector.join(",")}]`;
}

function translateFilter(filter: Record<string, unknown>): Prisma.Sql {
  const type = z.string().parse(filter.type);
  if (type === "and" || type === "or") {
    const children = z.array(z.record(z.string(), z.unknown())).min(1).parse(filter.filters);
    const translated = children.map(translateFilter);
    return type === "and"
      ? Prisma.sql`(${Prisma.join(translated, " AND ")})`
      : Prisma.sql`(${Prisma.join(translated, " OR ")})`;
  }
  const key = z.string().trim().min(1).parse(filter.key);
  const value = filter.value;
  switch (type) {
    case "eq":
      return Prisma.sql`chunk.attributes @> ${JSON.stringify({ [key]: value })}::jsonb`;
    case "ne":
      return Prisma.sql`NOT (chunk.attributes @> ${JSON.stringify({ [key]: value })}::jsonb)`;
    case "in":
    case "nin": {
      const values = z.array(z.unknown()).min(1).parse(value);
      const comparisons = values.map((candidate) =>
        Prisma.sql`chunk.attributes @> ${JSON.stringify({ [key]: candidate })}::jsonb`
      );
      const combined = Prisma.sql`(${Prisma.join(comparisons, " OR ")})`;
      return type === "in" ? combined : Prisma.sql`NOT ${combined}`;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return rangeFilter(type, key, value);
    default:
      throw new Error(`Unsupported Vector Store filter type: ${type}.`);
  }
}

function rangeFilter(
  type: "gt" | "gte" | "lt" | "lte",
  key: string,
  value: unknown,
): Prisma.Sql {
  const operator = {
    gt: Prisma.sql`>`,
    gte: Prisma.sql`>=`,
    lt: Prisma.sql`<`,
    lte: Prisma.sql`<=`,
  }[type];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Prisma.sql`(
      jsonb_typeof(chunk.attributes -> ${key}) = 'number'
      AND (chunk.attributes ->> ${key})::double precision ${operator} ${value}
    )`;
  }
  if (typeof value === "string") {
    return Prisma.sql`(
      jsonb_typeof(chunk.attributes -> ${key}) = 'string'
      AND (chunk.attributes ->> ${key}) ${operator} ${value}
    )`;
  }
  throw new Error(`Vector Store ${type} filters require a finite number or string value.`);
}
