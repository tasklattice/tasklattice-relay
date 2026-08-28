import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ControlJobPublisher } from "../jobs/control-job-queue";
import { createTestStore } from "../test/store";
import type { VectorDocumentParser } from "./docling-client";
import { KnowledgeVectorDatabase } from "./knowledge-vector-database";
import { VectorDocumentService } from "./vector-document-service";

async function setup() {
  const store = createTestStore();
  const definition = await store.saveKnowledgeSourceDefinition({
    id: "built-in-vectors",
    name: "Built-in vectors",
    description: "Docling-backed Project documents.",
    vectorStoreId: "built-in-vectors",
    provider: "postgresql",
    embeddingModel: "tali/openai/text-embedding-3-small",
    embeddingDimensions: 3,
    credentialReference: "",
    status: "REGISTERED",
    lastReconciliationError: null,
    topK: 8,
  });
  const vectors = new KnowledgeVectorDatabase(store, {
    createEmbeddings: vi.fn(async (_model: string, input: string[]) =>
      input.map(() => [0.1, 0.2, 0.3])
    ),
  });
  await vectors.provision(definition);
  const replace = vi.spyOn(vectors, "replaceDocumentChunks").mockResolvedValue({ upserted: 1 });
  const parser: VectorDocumentParser = {
    parse: vi.fn(async () => ({
      chunks: [{
        attributes: { doc_items: ["#/texts/1"], page_numbers: [1] },
        content: "A parsed section",
        index: 0,
        label: "text",
        pageNumber: 1,
        sectionPath: ["Introduction"],
        tokenCount: 4,
      }],
      document: { pages: { "1": {} } },
      ocrPageCount: 0,
      pageCount: 1,
      processingTimeSeconds: 0.1,
    })),
  };
  const publisher: ControlJobPublisher = {
    enqueueProjectDeletion: vi.fn(async () => randomUUID()),
    enqueueProjectRuntimeReconcile: vi.fn(async () => randomUUID()),
    enqueueVectorDocumentIngestion: vi.fn(async () => randomUUID()),
    start: vi.fn(async () => undefined),
  };
  return {
    parser,
    publisher,
    replace,
    service: new VectorDocumentService(store, vectors, parser),
    store,
  };
}

function upload(content: string, name = "handbook.pdf") {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    size: bytes.byteLength,
    type: "application/pdf",
    arrayBuffer: async () => bytes.buffer,
  };
}

describe("VectorDocumentService", () => {
  it("queues, parses, embeds, and activates a Docling document revision", async () => {
    const { parser, publisher, replace, service, store } = await setup();
    const queued = await service.queue("built-in-vectors", upload("pdf-v1"), "account-1", publisher);

    expect(queued.document.status).toBe("QUEUED");
    expect(publisher.enqueueVectorDocumentIngestion).toHaveBeenCalledOnce();
    await service.process({
      projectId: store.projectId,
      databaseId: "built-in-vectors",
      ingestionJobId: queued.job.id,
    });

    expect(parser.parse).toHaveBeenCalledWith(expect.objectContaining({ filename: "handbook.pdf" }));
    expect(replace).toHaveBeenCalledWith("built-in-vectors", expect.objectContaining({
      documentId: queued.document.id,
      revision: 1,
    }));
    await expect(service.overview("built-in-vectors")).resolves.toMatchObject({
      documents: [{
        id: queued.document.id,
        status: "READY",
        activeRevision: 1,
        chunkCount: 1,
        pageCount: 1,
      }],
      jobs: [{ id: queued.job.id, status: "COMPLETED", progress: 100 }],
    });
    await expect(store.database().vectorDocumentRevision.findFirstOrThrow({
      where: { documentId: queued.document.id, revision: 1 },
    })).resolves.toMatchObject({ sourceBytes: null });
  });

  it("separates the lightweight file preview from explicit chunk loading", async () => {
    const { publisher, service, store } = await setup();
    const queued = await service.queue("built-in-vectors", upload("preview-source"), "account-1", publisher);
    await store.database().vectorDocument.update({
      where: { projectId_databaseId_id: { projectId: store.projectId, databaseId: "built-in-vectors", id: queued.document.id } },
      data: { chunkCount: 2, status: "READY" },
    });
    for (const [index, content] of ["First indexed section", "Second indexed section"].entries()) {
      await store.database().$executeRawUnsafe(
        `INSERT INTO tasklattice.knowledge_vector_chunks (
          project_id, database_id, id, content, filename, attributes,
          document_id, document_revision, chunk_index, token_count,
          section_path, embedding_dimensions, embedding
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, ARRAY[]::TEXT[], $11, $12)`,
        store.projectId,
        "built-in-vectors",
        `preview-chunk-${index}`,
        content,
        queued.document.filename,
        JSON.stringify({}),
        queued.document.id,
        1,
        index,
        3,
        3,
        "[0.1,0.2,0.3]",
      );
    }

    await expect(service.document("built-in-vectors", queued.document.id)).resolves.toMatchObject({
      previewText: "First indexed section\n\nSecond indexed section",
      previewTruncated: false,
    });
    vi.spyOn(store.database().knowledgeVectorChunk, "findMany").mockResolvedValue([
      { id: "preview-chunk-0", content: "First indexed section", pageNumber: 1, chunkIndex: 0, tokenCount: 3, sectionPath: [], label: "text", attributes: {} },
      { id: "preview-chunk-1", content: "Second indexed section", pageNumber: 1, chunkIndex: 1, tokenCount: 3, sectionPath: [], label: "text", attributes: {} },
    ] as never);
    await expect(service.documentChunks("built-in-vectors", queued.document.id)).resolves.toMatchObject({
      total: 2,
      truncated: false,
      chunks: [
        { id: "preview-chunk-0", chunkIndex: 0, content: "First indexed section" },
        { id: "preview-chunk-1", chunkIndex: 1, content: "Second indexed section" },
      ],
    });
  });

  it("allocates revisions from persisted history while the active revision is unchanged", async () => {
    const { publisher, service, store } = await setup();
    const first = await service.queue("built-in-vectors", upload("pdf-v1"), "account-1", publisher);
    const second = await service.queue("built-in-vectors", upload("pdf-v2"), "account-1", publisher);

    expect(second.document.id).toBe(first.document.id);
    expect(second.job.revision).toBe(2);
    await expect(store.database().vectorDocumentRevision.findMany({
      where: { documentId: first.document.id },
      orderBy: { revision: "asc" },
    })).resolves.toMatchObject([{ revision: 1 }, { revision: 2 }]);
  });

  it("keeps the same filename in separate persistent directories", async () => {
    const { publisher, service } = await setup();
    const research = await service.queue(
      "built-in-vectors",
      upload("research"),
      "account-1",
      publisher,
      { directoryPath: "/Research/Agents" },
    );
    const reports = await service.queue(
      "built-in-vectors",
      upload("reports"),
      "account-1",
      publisher,
      { directoryPath: "/Reports" },
    );

    expect(research.document.id).not.toBe(reports.document.id);
    expect(research.document.directoryPath).toBe("/Research/Agents");
    expect(reports.document.directoryPath).toBe("/Reports");
  });

  it("creates nested logical folders and uploads into the selected folder", async () => {
    const { publisher, service } = await setup();
    const research = await service.createFolder("built-in-vectors", {
      name: "Research",
      parentId: null,
    });
    const agents = await service.createFolder("built-in-vectors", {
      name: "Agents",
      parentId: research.id,
    });
    const queued = await service.queue(
      "built-in-vectors",
      upload("nested-file"),
      "account-1",
      publisher,
      { folderId: agents.id },
    );

    expect(queued.document).toMatchObject({
      folderId: agents.id,
      directoryPath: "/Research/Agents",
    });
    await expect(service.overview("built-in-vectors")).resolves.toMatchObject({
      folders: expect.arrayContaining([
        expect.objectContaining({ id: research.id, path: "/Research", totalFileCount: 1 }),
        expect.objectContaining({ id: agents.id, path: "/Research/Agents", totalFileCount: 1 }),
      ]),
    });
  });

  it("renames and moves files and folders without creating new embeddings", async () => {
    const { publisher, replace, service, store } = await setup();
    const source = await service.createFolder("built-in-vectors", { name: "Source", parentId: null });
    const destination = await service.createFolder("built-in-vectors", { name: "Destination", parentId: null });
    const queued = await service.queue(
      "built-in-vectors",
      upload("move-me"),
      "account-1",
      publisher,
      { folderId: source.id },
    );

    const moved = await service.updateDocument("built-in-vectors", queued.document.id, {
      filename: "renamed.pdf",
      folderId: destination.id,
    });
    expect(moved).toMatchObject({
      filename: "renamed.pdf",
      folderId: destination.id,
      directoryPath: "/Destination",
    });
    const renamedFolder = await service.updateFolder("built-in-vectors", destination.id, {
      name: "Published",
    });
    expect(renamedFolder.path).toBe("/Published");
    await expect(store.database().vectorDocument.findFirstOrThrow({
      where: { id: queued.document.id },
    })).resolves.toMatchObject({ directoryPath: "/Published" });
    expect(replace).not.toHaveBeenCalled();
  });

  it("persists typed file metadata and propagates it to Vector Records without re-embedding", async () => {
    const { publisher, replace, service, store } = await setup();
    const queued = await service.queue(
      "built-in-vectors",
      upload("metadata-source"),
      "account-1",
      publisher,
    );
    await store.database().$executeRawUnsafe(
      `INSERT INTO tasklattice.knowledge_vector_chunks (
        project_id, database_id, id, content, filename, attributes,
        document_id, document_revision, chunk_index, token_count,
        embedding_dimensions, embedding
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)`,
      store.projectId,
      "built-in-vectors",
      "metadata-chunk",
      "A metadata-aware chunk",
      queued.document.filename,
      JSON.stringify({ document_id: queued.document.id, tali_metadata_stale: "remove-me" }),
      queued.document.id,
      1,
      0,
      4,
      3,
      "[0.1,0.2,0.3]",
    );

    const updated = await service.updateDocument("built-in-vectors", queued.document.id, {
      customMetadata: {
        department: { type: "string", value: "research" },
        priority: { type: "number", value: 3 },
        approved: { type: "boolean", value: true },
        review_date: { type: "date", value: "2026-09-01" },
      },
    });

    expect(updated.customMetadata).toEqual({
      department: { type: "string", value: "research" },
      priority: { type: "number", value: 3 },
      approved: { type: "boolean", value: true },
      review_date: { type: "date", value: "2026-09-01" },
    });
    const storedChunk = await store.database().knowledgeVectorChunk.findFirstOrThrow({
      where: { id: "metadata-chunk" },
      select: { attributes: true },
    });
    expect(storedChunk).toMatchObject({
      attributes: expect.objectContaining({
        tali_metadata_department: "research",
        tali_metadata_priority: 3,
        tali_metadata_approved: true,
        tali_metadata_review_date: "2026-09-01",
      }),
    });
    expect(storedChunk.attributes).not.toHaveProperty("tali_metadata_stale");
    await expect(service.overview("built-in-vectors")).resolves.toMatchObject({
      metadataSchema: [
        { key: "approved", type: "boolean", documentCount: 1 },
        { key: "department", type: "string", documentCount: 1 },
        { key: "priority", type: "number", documentCount: 1 },
        { key: "review_date", type: "date", documentCount: 1 },
      ],
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("reports recursive file and Vector Record counts when deleting a folder", async () => {
    const { publisher, service, store } = await setup();
    const parent = await service.createFolder("built-in-vectors", { name: "Archive", parentId: null });
    const child = await service.createFolder("built-in-vectors", { name: "Old", parentId: parent.id });
    const ready = await service.queue(
      "built-in-vectors",
      upload("ready"),
      "account-1",
      publisher,
      { folderId: child.id },
    );
    await store.database().vectorDocument.update({
      where: { projectId_databaseId_id: { projectId: store.projectId, databaseId: "built-in-vectors", id: ready.document.id } },
      data: { chunkCount: 18, status: "READY" },
    });
    const failed = await service.queue(
      "built-in-vectors",
      upload("failed", "failed.pdf"),
      "account-1",
      publisher,
      { folderId: parent.id },
    );
    await store.database().vectorDocument.update({
      where: { projectId_databaseId_id: { projectId: store.projectId, databaseId: "built-in-vectors", id: failed.document.id } },
      data: { status: "FAILED" },
    });

    await expect(service.deleteFolder("built-in-vectors", parent.id)).resolves.toEqual({
      fileCount: 2,
      vectorCount: 18,
      processingFileCount: 0,
      failedFileCount: 1,
    });
    await expect(store.database().vectorDocument.count({
      where: { databaseId: "built-in-vectors" },
    })).resolves.toBe(0);
  });
});
