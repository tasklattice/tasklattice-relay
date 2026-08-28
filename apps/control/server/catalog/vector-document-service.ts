import { createHash, randomUUID } from "node:crypto";
import type {
  CreateVectorFolderInput,
  VectorCustomMetadata,
  VectorDatabaseOverview,
  VectorDeletionImpact,
  VectorDocument,
  VectorDocumentChunks,
  VectorDocumentDetail,
  VectorFolder,
  VectorIngestionJob,
  VectorMetadataField,
  UpdateVectorDocumentInput,
  UpdateVectorFolderInput,
} from "@tali/contracts";
import { vectorCustomMetadataSchema } from "@tali/contracts";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import type {
  ControlJobPublisher,
  VectorDocumentIngestionJobPayload,
} from "../jobs/control-job-queue";
import { ProjectStore } from "../projects/project-store";
import { DoclingClient, type VectorDocumentParser } from "./docling-client";
import { KnowledgeVectorDatabase } from "./knowledge-vector-database";

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const DOCUMENT_PREVIEW_CHARACTERS = 1_600;
const DOCUMENT_PREVIEW_CHUNKS = 8;
const CUSTOM_METADATA_ATTRIBUTE_PREFIX = "tali_metadata_";
const ACCEPTED_EXTENSIONS = new Set([
  "pdf", "docx", "pptx", "xlsx", "html", "htm", "md", "txt",
  "png", "jpg", "jpeg", "tif", "tiff",
]);

export interface UploadedVectorDocument {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface QueueVectorDocumentOptions {
  readonly directoryPath?: string;
  readonly folderId?: string | null;
}

export class VectorDocumentService {
  constructor(
    readonly store: ProjectStore,
    readonly vectors: KnowledgeVectorDatabase,
    readonly parser: VectorDocumentParser = new DoclingClient(),
    readonly db: PrismaClient = store.database(),
  ) {}

  async overview(databaseId: string): Promise<VectorDatabaseOverview> {
    const database = await this.requireDatabase(databaseId);
    if (database.provider !== "postgresql") {
      const sourceRecord = await this.db.knowledgeSourceRecord.findUnique({
        where: { projectId_id: { projectId: this.store.projectId, id: databaseId } },
        select: { createdAt: true, updatedAt: true },
      });
      const timestamps = sourceRecord ?? { createdAt: new Date(), updatedAt: new Date() };
      return {
        database,
        createdAt: timestamps.createdAt.toISOString(),
        updatedAt: timestamps.updatedAt.toISOString(),
        stats: emptyStats(),
        metadataSchema: [],
        folders: [],
        documents: [],
        jobs: [],
      };
    }
    const [documents, folders, jobs, chunkCount, sourceRecord] = await Promise.all([
      this.db.vectorDocument.findMany({
        where: { projectId: this.store.projectId, databaseId },
        orderBy: { updatedAt: "desc" },
      }),
      this.db.vectorFolder.findMany({
        where: { projectId: this.store.projectId, databaseId },
        orderBy: [{ parentId: "asc" }, { name: "asc" }],
      }),
      this.db.vectorIngestionJob.findMany({
        where: { projectId: this.store.projectId, databaseId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.db.knowledgeVectorChunk.count({
        where: { projectId: this.store.projectId, databaseId },
      }),
      this.db.knowledgeSourceRecord.findUnique({
        where: { projectId_id: { projectId: this.store.projectId, id: databaseId } },
        select: { createdAt: true, updatedAt: true },
      }),
    ]);
    const timestamps = sourceRecord ?? { createdAt: new Date(), updatedAt: new Date() };
    return {
      database,
      createdAt: timestamps.createdAt.toISOString(),
      updatedAt: timestamps.updatedAt.toISOString(),
      stats: {
        documentCount: documents.length,
        readyDocumentCount: documents.filter((item) => item.status === "READY").length,
        failedDocumentCount: documents.filter((item) => item.status === "FAILED").length,
        processingDocumentCount: documents.filter((item) =>
          item.status === "QUEUED" || item.status === "PARSING" || item.status === "EMBEDDING"
        ).length,
        chunkCount,
      },
      metadataSchema: vectorMetadataFields(documents),
      folders: vectorFolders(folders, documents),
      documents: documents.map(vectorDocument),
      jobs: jobs.map(vectorIngestionJob),
    };
  }

  async document(databaseId: string, documentId: string): Promise<VectorDocumentDetail> {
    await this.requireBuiltInDatabase(databaseId);
    const document = await this.db.vectorDocument.findUnique({
      where: {
        projectId_databaseId_id: {
          projectId: this.store.projectId,
          databaseId,
          id: documentId,
        },
      },
    });
    if (!document) throw new Error("Vector Document was not found.");
    const chunks = await this.db.knowledgeVectorChunk.findMany({
      where: {
        projectId: this.store.projectId,
        databaseId,
        documentId,
        documentRevision: document.activeRevision,
      },
      orderBy: { chunkIndex: "asc" },
      select: { content: true },
      take: DOCUMENT_PREVIEW_CHUNKS,
    });
    const indexedText = chunks.map((chunk) => chunk.content).join("\n\n").trim();
    return {
      ...vectorDocument(document),
      previewText: indexedText.slice(0, DOCUMENT_PREVIEW_CHARACTERS).trimEnd(),
      previewTruncated:
        indexedText.length > DOCUMENT_PREVIEW_CHARACTERS
        || document.chunkCount > chunks.length,
    };
  }

  async documentChunks(databaseId: string, documentId: string): Promise<VectorDocumentChunks> {
    await this.requireBuiltInDatabase(databaseId);
    const document = await this.db.vectorDocument.findUnique({
      where: {
        projectId_databaseId_id: {
          projectId: this.store.projectId,
          databaseId,
          id: documentId,
        },
      },
      select: { activeRevision: true, chunkCount: true },
    });
    if (!document) throw new Error("Vector Document was not found.");
    const chunks = await this.db.knowledgeVectorChunk.findMany({
      where: {
        projectId: this.store.projectId,
        databaseId,
        documentId,
        documentRevision: document.activeRevision,
      },
      orderBy: { chunkIndex: "asc" },
      take: 2_000,
    });
    return {
      chunks: chunks.map((chunk) => ({
        id: chunk.id,
        content: chunk.content,
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex ?? 0,
        tokenCount: chunk.tokenCount ?? 0,
        sectionPath: chunk.sectionPath,
        label: chunk.label,
        attributes: jsonRecord(chunk.attributes),
      })),
      total: document.chunkCount,
      truncated: document.chunkCount > chunks.length,
    };
  }

  async metadataFields(databaseId: string): Promise<VectorMetadataField[]> {
    await this.requireBuiltInDatabase(databaseId);
    const documents = await this.db.vectorDocument.findMany({
      where: { projectId: this.store.projectId, databaseId },
      select: { customMetadata: true },
    });
    return vectorMetadataFields(documents);
  }

  async queue(
    databaseId: string,
    file: UploadedVectorDocument,
    uploadedBy: string,
    jobs: ControlJobPublisher,
    options: QueueVectorDocumentOptions = {},
  ): Promise<{ document: VectorDocument; job: VectorIngestionJob }> {
    await this.requireBuiltInDatabase(databaseId);
    const filename = safeFilename(file.name);
    const destination = await this.resolveQueueFolder(databaseId, options);
    const directoryPath = destination.path;
    const folderId = destination.folderId;
    validateUpload(filename, file.type, file.size);
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateUpload(filename, file.type, bytes.byteLength);
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const ingestionJobId = randomUUID();
    await jobs.start();
    const queued = await this.db.$transaction(async (transaction) => {
      // Serialize uploads of the same logical document. This keeps concurrent
      // requests from allocating the same revision without locking unrelated
      // Vector Databases or filenames.
      await transaction.$queryRaw<{ locked: number }[]>`
        SELECT 1 AS locked
        FROM (
          SELECT pg_advisory_xact_lock(
            ${advisoryKey(this.store.projectId)},
            ${advisoryKey(`${databaseId}:${folderId ?? "root"}:${filename}`)}
          )
        ) AS acquired
      `;
      const current = await transaction.vectorDocument.findFirst({
        where: { projectId: this.store.projectId, databaseId, folderId, filename },
        orderBy: { createdAt: "desc" },
        include: {
          revisions: {
            orderBy: { revision: "desc" },
            select: { revision: true },
            take: 1,
          },
        },
      });
      const documentId = current?.id ?? documentIdentifier(`${directoryPath}/${filename}`);
      // A failed or still-pending revision does not advance activeRevision.
      const revision = (current?.revisions[0]?.revision ?? 0) + 1;
      if (current) {
        await transaction.vectorDocument.update({
          where: {
            projectId_databaseId_id: {
              projectId: this.store.projectId,
              databaseId,
              id: documentId,
            },
          },
          data: {
            byteSize: bytes.byteLength,
            error: null,
            filename,
            directoryPath,
            folderId,
            mediaType: file.type || mediaTypeFromFilename(filename),
            status: "QUEUED",
            uploadedBy,
          },
        });
      } else {
        await transaction.vectorDocument.create({
          data: {
            projectId: this.store.projectId,
            databaseId,
            id: documentId,
            filename,
            directoryPath,
            folderId,
            mediaType: file.type || mediaTypeFromFilename(filename),
            byteSize: bytes.byteLength,
            contentHash,
            status: "QUEUED",
            activeRevision: 1,
            parser: "docling",
            uploadedBy,
          },
        });
      }
      await transaction.vectorDocumentRevision.create({
        data: {
          projectId: this.store.projectId,
          databaseId,
          documentId,
          revision,
          contentHash,
          sourceBytes: bytes,
        },
      });
      await transaction.vectorIngestionJob.create({
        data: {
          id: ingestionJobId,
          projectId: this.store.projectId,
          databaseId,
          documentId,
          revision,
        },
      });
      if (!jobs.enqueueVectorDocumentIngestion) {
        throw new Error("The Control Worker queue does not support Vector Document ingestion.");
      }
      const queueJobId = await jobs.enqueueVectorDocumentIngestion(
        { projectId: this.store.projectId, databaseId, ingestionJobId },
        transaction,
      );
      await transaction.vectorIngestionJob.update({
        where: { id: ingestionJobId },
        data: { queueJobId },
      });
      return { documentId, revision };
    });
    const [document, job] = await Promise.all([
      this.db.vectorDocument.findUniqueOrThrow({
        where: { projectId_databaseId_id: { projectId: this.store.projectId, databaseId, id: queued.documentId } },
      }),
      this.db.vectorIngestionJob.findUniqueOrThrow({ where: { id: ingestionJobId } }),
    ]);
    return { document: vectorDocument(document), job: vectorIngestionJob(job) };
  }

  async process(payload: VectorDocumentIngestionJobPayload, retryCount = 0): Promise<void> {
    const job = await this.db.vectorIngestionJob.findFirst({
      where: { id: payload.ingestionJobId, projectId: this.store.projectId, databaseId: payload.databaseId },
      include: { document: true, revisionRecord: true },
    });
    if (!job || job.status === "COMPLETED") return;
    if (!job.revisionRecord.sourceBytes) {
      throw new Error("The queued Vector Document source is no longer available.");
    }
    await this.updateProgress(payload.databaseId, job.id, job.documentId, {
      status: "RUNNING",
      phase: "PARSING",
      progress: 10,
      attempts: retryCount + 1,
      startedAt: new Date(),
      completedAt: null,
      error: null,
    }, { status: "PARSING", error: null });
    try {
      const parsed = await this.parser.parse({
        bytes: job.revisionRecord.sourceBytes,
        filename: job.document.filename,
        mediaType: job.document.mediaType,
      });
      await this.updateProgress(payload.databaseId, job.id, job.documentId, {
        phase: "EMBEDDING",
        progress: 55,
      }, { status: "EMBEDDING" });
      await this.vectors.replaceDocumentChunks(payload.databaseId, {
        contentHash: job.revisionRecord.contentHash,
        documentId: job.documentId,
        directoryPath: job.document.directoryPath,
        folderId: job.document.folderId,
        filename: job.document.filename,
        customMetadata: parseCustomMetadata(job.document.customMetadata),
        revision: job.revision,
        chunks: parsed.chunks,
      });
      await this.updateProgress(payload.databaseId, job.id, job.documentId, {
        phase: "FINALIZING",
        progress: 90,
      });
      await this.db.$transaction([
        this.db.knowledgeVectorChunk.deleteMany({
          where: {
            projectId: this.store.projectId,
            databaseId: payload.databaseId,
            documentId: job.documentId,
            documentRevision: { not: job.revision },
          },
        }),
        this.db.vectorDocumentRevision.update({
          where: {
            projectId_databaseId_documentId_revision: {
              projectId: this.store.projectId,
              databaseId: payload.databaseId,
              documentId: job.documentId,
              revision: job.revision,
            },
          },
          data: {
            completedAt: new Date(),
            ...(parsed.document === null
              ? {}
              : { doclingDocument: parsed.document as Prisma.InputJsonValue }),
            sourceBytes: null,
          },
        }),
        this.db.vectorDocument.update({
          where: {
            projectId_databaseId_id: {
              projectId: this.store.projectId,
              databaseId: payload.databaseId,
              id: job.documentId,
            },
          },
          data: {
            activeRevision: job.revision,
            chunkCount: parsed.chunks.length,
            contentHash: job.revisionRecord.contentHash,
            error: null,
            ocrPageCount: parsed.ocrPageCount,
            pageCount: parsed.pageCount,
            status: "READY",
          },
        }),
        this.db.vectorIngestionJob.update({
          where: { id: job.id },
          data: {
            completedAt: new Date(),
            error: null,
            phase: "COMPLETED",
            progress: 100,
            status: "COMPLETED",
          },
        }),
      ]);
    } catch (error) {
      const message = safeError(error);
      await this.updateProgress(payload.databaseId, job.id, job.documentId, {
        completedAt: new Date(),
        error: message,
        phase: "FAILED",
        status: "FAILED",
      }, { error: message, status: "FAILED" });
      throw error;
    }
  }

  async delete(databaseId: string, documentId: string): Promise<boolean> {
    await this.requireBuiltInDatabase(databaseId);
    const deleted = await this.db.vectorDocument.deleteMany({
      where: { projectId: this.store.projectId, databaseId, id: documentId },
    });
    return deleted.count > 0;
  }

  async createFolder(
    databaseId: string,
    input: CreateVectorFolderInput,
  ): Promise<VectorFolder> {
    await this.requireBuiltInDatabase(databaseId);
    const name = safeFolderName(input.name);
    await this.requireFolder(databaseId, input.parentId);
    await this.assertFolderNameAvailable(databaseId, input.parentId, name);
    const created = await this.db.vectorFolder.create({
      data: {
        projectId: this.store.projectId,
        databaseId,
        parentId: input.parentId,
        name,
      },
    });
    return this.folder(databaseId, created.id);
  }

  async updateFolder(
    databaseId: string,
    folderId: string,
    input: UpdateVectorFolderInput,
  ): Promise<VectorFolder> {
    await this.requireBuiltInDatabase(databaseId);
    const folders = await this.db.vectorFolder.findMany({
      where: { projectId: this.store.projectId, databaseId },
    });
    const current = folders.find((item) => item.id === folderId);
    if (!current) throw new Error("Vector Folder was not found.");
    const nextParentId = input.parentId === undefined ? current.parentId : input.parentId;
    const nextName = input.name === undefined ? current.name : safeFolderName(input.name);
    if (nextParentId === folderId || descendantFolderIds(folders, folderId).has(nextParentId ?? "")) {
      throw new Error("A Vector Folder cannot be moved inside itself.");
    }
    await this.requireFolder(databaseId, nextParentId);
    await this.assertFolderNameAvailable(databaseId, nextParentId, nextName, folderId);
    const oldPath = folderPath(current.id, folders);
    const parentPath = nextParentId ? folderPath(nextParentId, folders) : "/";
    const nextPath = joinPath(parentPath, nextName);
    const documents = await this.db.vectorDocument.findMany({
      where: {
        projectId: this.store.projectId,
        databaseId,
        OR: [{ directoryPath: oldPath }, { directoryPath: { startsWith: `${oldPath}/` } }],
      },
    });
    await this.db.$transaction(async (transaction) => {
      await transaction.vectorFolder.update({
        where: { projectId_databaseId_id: { projectId: this.store.projectId, databaseId, id: folderId } },
        data: { name: nextName, parentId: nextParentId },
      });
      for (const document of documents) {
        const directoryPath = `${nextPath}${document.directoryPath.slice(oldPath.length)}`;
        await transaction.vectorDocument.update({
          where: { projectId_databaseId_id: { projectId: this.store.projectId, databaseId, id: document.id } },
          data: { directoryPath },
        });
      }
      await refreshChunkFileMetadata(transaction, this.store.projectId, databaseId, documents.map((item) => item.id));
    });
    return this.folder(databaseId, folderId);
  }

  async deleteFolder(
    databaseId: string,
    folderId: string,
  ): Promise<VectorDeletionImpact | undefined> {
    await this.requireBuiltInDatabase(databaseId);
    const [folders, documents] = await Promise.all([
      this.db.vectorFolder.findMany({ where: { projectId: this.store.projectId, databaseId } }),
      this.db.vectorDocument.findMany({ where: { projectId: this.store.projectId, databaseId } }),
    ]);
    if (!folders.some((item) => item.id === folderId)) return undefined;
    const folderIds = descendantFolderIds(folders, folderId);
    folderIds.add(folderId);
    const nestedDocuments = documents.filter((item) => item.folderId && folderIds.has(item.folderId));
    const impact = deletionImpact(nestedDocuments);
    await this.db.$transaction(async (transaction) => {
      await transaction.vectorDocument.deleteMany({
        where: {
          projectId: this.store.projectId,
          databaseId,
          id: { in: nestedDocuments.map((item) => item.id) },
        },
      });
      await transaction.vectorFolder.deleteMany({
        where: { projectId: this.store.projectId, databaseId, id: folderId },
      });
    });
    return impact;
  }

  async updateDocument(
    databaseId: string,
    documentId: string,
    input: UpdateVectorDocumentInput,
  ): Promise<VectorDocument> {
    await this.requireBuiltInDatabase(databaseId);
    const current = await this.db.vectorDocument.findUnique({
      where: { projectId_databaseId_id: { projectId: this.store.projectId, databaseId, id: documentId } },
    });
    if (!current) throw new Error("Vector Document was not found.");
    const folderId = input.folderId === undefined ? current.folderId : input.folderId;
    const filename = input.filename === undefined ? current.filename : safeFilename(input.filename);
    const customMetadata = input.customMetadata === undefined
      ? parseCustomMetadata(current.customMetadata)
      : input.customMetadata;
    await this.assertMetadataTypes(databaseId, documentId, customMetadata);
    const folder = await this.requireFolder(databaseId, folderId);
    const duplicate = await this.db.vectorDocument.findFirst({
      where: {
        projectId: this.store.projectId,
        databaseId,
        folderId,
        filename,
        id: { not: documentId },
      },
      select: { id: true },
    });
    if (duplicate) throw new Error(`A file named “${filename}” already exists in this folder.`);
    const directoryPath = folder
      ? folderPath(folder.id, await this.db.vectorFolder.findMany({ where: { projectId: this.store.projectId, databaseId } }))
      : "/";
    const updated = await this.db.$transaction(async (transaction) => {
      const document = await transaction.vectorDocument.update({
        where: { projectId_databaseId_id: { projectId: this.store.projectId, databaseId, id: documentId } },
        data: {
          directoryPath,
          filename,
          folderId,
          customMetadata: customMetadata as Prisma.InputJsonValue,
        },
      });
      await refreshChunkFileMetadata(transaction, this.store.projectId, databaseId, [documentId]);
      return document;
    });
    return vectorDocument(updated);
  }

  private async assertMetadataTypes(
    databaseId: string,
    documentId: string,
    metadata: VectorCustomMetadata,
  ): Promise<void> {
    const documents = await this.db.vectorDocument.findMany({
      where: { projectId: this.store.projectId, databaseId, id: { not: documentId } },
      select: { customMetadata: true },
    });
    const existing = new Map(vectorMetadataFields(documents).map((field) => [field.key, field.type]));
    for (const [key, value] of Object.entries(metadata)) {
      const expected = existing.get(key);
      if (expected && expected !== value.type) {
        throw new Error(`Metadata field “${key}” already uses the ${expected} type in this Vector Database.`);
      }
    }
  }

  private async updateProgress(
    databaseId: string,
    jobId: string,
    documentId: string,
    job: Prisma.VectorIngestionJobUpdateManyMutationInput,
    document?: Prisma.VectorDocumentUpdateManyMutationInput,
  ): Promise<void> {
    await this.db.$transaction([
      this.db.vectorIngestionJob.updateMany({
        where: { id: jobId, projectId: this.store.projectId, databaseId },
        data: job,
      }),
      ...(document ? [this.db.vectorDocument.updateMany({
        where: { projectId: this.store.projectId, databaseId, id: documentId },
        data: document,
      })] : []),
    ]);
  }

  private async requireDatabase(databaseId: string) {
    const database = await this.store.getKnowledgeSourceDefinition(databaseId);
    if (!database) throw new Error("Vector Database was not found.");
    return database;
  }

  private async requireBuiltInDatabase(databaseId: string) {
    const database = await this.requireDatabase(databaseId);
    if (database.provider !== "postgresql") {
      throw new Error("Document ingestion is available only for the built-in PostgreSQL Vector Database.");
    }
    if (database.status !== "REGISTERED") {
      throw new Error("The built-in Vector Database must be registered before documents can be ingested.");
    }
    return database;
  }

  private async requireFolder(databaseId: string, folderId: string | null) {
    if (!folderId) return null;
    const folder = await this.db.vectorFolder.findUnique({
      where: { projectId_databaseId_id: { projectId: this.store.projectId, databaseId, id: folderId } },
    });
    if (!folder) throw new Error("Vector Folder was not found.");
    return folder;
  }

  private async assertFolderNameAvailable(
    databaseId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const duplicate = await this.db.vectorFolder.findFirst({
      where: {
        projectId: this.store.projectId,
        databaseId,
        parentId,
        name,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new Error(`A folder named “${name}” already exists here.`);
  }

  private async folder(databaseId: string, folderId: string): Promise<VectorFolder> {
    const [folders, documents] = await Promise.all([
      this.db.vectorFolder.findMany({ where: { projectId: this.store.projectId, databaseId } }),
      this.db.vectorDocument.findMany({ where: { projectId: this.store.projectId, databaseId } }),
    ]);
    const result = vectorFolders(folders, documents).find((item) => item.id === folderId);
    if (!result) throw new Error("Vector Folder was not found.");
    return result;
  }

  private async resolveQueueFolder(
    databaseId: string,
    options: QueueVectorDocumentOptions,
  ): Promise<{ folderId: string | null; path: string }> {
    if (options.folderId !== undefined) {
      const folder = await this.requireFolder(databaseId, options.folderId);
      if (!folder) return { folderId: null, path: "/" };
      const folders = await this.db.vectorFolder.findMany({ where: { projectId: this.store.projectId, databaseId } });
      return { folderId: folder.id, path: folderPath(folder.id, folders) };
    }
    const path = safeDirectoryPath(options.directoryPath);
    if (path === "/") return { folderId: null, path };
    let parentId: string | null = null;
    for (const name of path.split("/").filter(Boolean)) {
      const existing: { id: string } | null = await this.db.vectorFolder.findFirst({
        where: { projectId: this.store.projectId, databaseId, parentId, name },
        select: { id: true },
      });
      const folder: { id: string } = existing ?? await this.db.vectorFolder.create({
        data: { projectId: this.store.projectId, databaseId, parentId, name },
        select: { id: true },
      });
      parentId = folder.id;
    }
    return { folderId: parentId, path };
  }
}

function vectorDocument(document: {
  id: string;
  databaseId: string;
  folderId: string | null;
  filename: string;
  directoryPath: string;
  mediaType: string;
  byteSize: number;
  contentHash: string;
  status: string;
  activeRevision: number;
  pageCount: number;
  chunkCount: number;
  ocrPageCount: number;
  parser: string;
  uploadedBy: string | null;
  customMetadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  error: string | null;
}): VectorDocument {
  return {
    id: document.id,
    databaseId: document.databaseId,
    folderId: document.folderId,
    filename: document.filename,
    directoryPath: document.directoryPath,
    mediaType: document.mediaType,
    byteSize: document.byteSize,
    contentHash: document.contentHash,
    status: document.status as VectorDocument["status"],
    activeRevision: document.activeRevision,
    pageCount: document.pageCount,
    chunkCount: document.chunkCount,
    ocrPageCount: document.ocrPageCount,
    parser: "docling",
    uploadedBy: document.uploadedBy,
    customMetadata: parseCustomMetadata(document.customMetadata),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    error: document.error,
  };
}

function vectorIngestionJob(job: {
  id: string;
  databaseId: string;
  documentId: string;
  revision: number;
  status: string;
  phase: string;
  progress: number;
  attempts: number;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}): VectorIngestionJob {
  return {
    id: job.id,
    databaseId: job.databaseId,
    documentId: job.documentId,
    revision: job.revision,
    status: job.status as VectorIngestionJob["status"],
    phase: job.phase as VectorIngestionJob["phase"],
    progress: job.progress,
    attempts: job.attempts,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    updatedAt: job.updatedAt.toISOString(),
  };
}

interface FolderRecord {
  id: string;
  databaseId: string;
  parentId: string | null;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

interface FolderDocumentRecord {
  folderId: string | null;
  status: string;
  chunkCount: number;
}

function vectorFolders(
  folders: readonly FolderRecord[],
  documents: readonly FolderDocumentRecord[],
): VectorFolder[] {
  return folders.map((folder) => {
    const nestedIds = descendantFolderIds(folders, folder.id);
    nestedIds.add(folder.id);
    const nestedDocuments = documents.filter((document) =>
      document.folderId !== null && nestedIds.has(document.folderId)
    );
    const impact = deletionImpact(nestedDocuments);
    return {
      id: folder.id,
      databaseId: folder.databaseId,
      parentId: folder.parentId,
      name: folder.name,
      path: folderPath(folder.id, folders),
      directChildCount:
        folders.filter((item) => item.parentId === folder.id).length
        + documents.filter((item) => item.folderId === folder.id).length,
      totalFileCount: impact.fileCount,
      totalVectorCount: impact.vectorCount,
      processingFileCount: impact.processingFileCount,
      failedFileCount: impact.failedFileCount,
      createdAt: folder.createdAt.toISOString(),
      updatedAt: folder.updatedAt.toISOString(),
    };
  });
}

function vectorMetadataFields(
  documents: readonly { customMetadata: unknown }[],
): VectorMetadataField[] {
  const fields = new Map<string, { type: VectorMetadataField["type"]; documentCount: number }>();
  for (const document of documents) {
    for (const [key, value] of Object.entries(parseCustomMetadata(document.customMetadata))) {
      const current = fields.get(key);
      if (current && current.type !== value.type) {
        throw new Error(`Metadata field “${key}” has inconsistent types in this Vector Database.`);
      }
      fields.set(key, { type: value.type, documentCount: (current?.documentCount ?? 0) + 1 });
    }
  }
  return [...fields.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .toSorted((left, right) => left.key.localeCompare(right.key));
}

function descendantFolderIds(
  folders: readonly Pick<FolderRecord, "id" | "parentId">[],
  folderId: string,
): Set<string> {
  const result = new Set<string>();
  const pending = [folderId];
  while (pending.length) {
    const parentId = pending.pop()!;
    for (const folder of folders) {
      if (folder.parentId !== parentId || result.has(folder.id)) continue;
      result.add(folder.id);
      pending.push(folder.id);
    }
  }
  return result;
}

function folderPath(
  folderId: string,
  folders: readonly Pick<FolderRecord, "id" | "name" | "parentId">[],
): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const segments: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);
  while (current) {
    if (visited.has(current.id)) throw new Error("Vector Folder hierarchy contains a cycle.");
    visited.add(current.id);
    segments.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  if (!segments.length) throw new Error("Vector Folder was not found.");
  return `/${segments.join("/")}`;
}

function deletionImpact(documents: readonly FolderDocumentRecord[]): VectorDeletionImpact {
  return {
    fileCount: documents.length,
    vectorCount: documents.reduce((total, document) => total + document.chunkCount, 0),
    processingFileCount: documents.filter((document) =>
      document.status === "QUEUED"
      || document.status === "PARSING"
      || document.status === "EMBEDDING"
    ).length,
    failedFileCount: documents.filter((document) => document.status === "FAILED").length,
  };
}

async function refreshChunkFileMetadata(
  transaction: Prisma.TransactionClient,
  projectId: string,
  databaseId: string,
  documentIds: readonly string[],
): Promise<void> {
  if (!documentIds.length) return;
  const [documents, chunks] = await Promise.all([
    transaction.vectorDocument.findMany({
      where: { projectId, databaseId, id: { in: [...documentIds] } },
    }),
    transaction.knowledgeVectorChunk.findMany({
      where: { projectId, databaseId, documentId: { in: [...documentIds] } },
      select: { id: true, documentId: true, attributes: true },
    }),
  ]);
  const byId = new Map(documents.map((document) => [document.id, document]));
  for (const chunk of chunks) {
    const document = chunk.documentId ? byId.get(chunk.documentId) : undefined;
    if (!document) continue;
    const retainedAttributes = Object.fromEntries(
      Object.entries(jsonRecord(chunk.attributes))
        .filter(([key]) => !key.startsWith(CUSTOM_METADATA_ATTRIBUTE_PREFIX)),
    );
    await transaction.knowledgeVectorChunk.update({
      where: { projectId_databaseId_id: { projectId, databaseId, id: chunk.id } },
      data: {
        filename: document.filename,
        attributes: {
          ...retainedAttributes,
          folder_id: document.folderId ?? "root",
          file_name: document.filename,
          file_path: document.directoryPath === "/"
            ? `/${document.filename}`
            : `${document.directoryPath}/${document.filename}`,
          ...customMetadataAttributes(document.customMetadata),
        },
      },
      select: { id: true },
    });
  }
}

function parseCustomMetadata(value: unknown): VectorCustomMetadata {
  const parsed = vectorCustomMetadataSchema.safeParse(jsonRecord(value));
  return parsed.success ? parsed.data : {};
}

function customMetadataAttributes(value: unknown): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(parseCustomMetadata(value))
      .map(([key, metadata]) => [`${CUSTOM_METADATA_ATTRIBUTE_PREFIX}${key}`, metadata.value]),
  );
}

function emptyStats() {
  return {
    documentCount: 0,
    readyDocumentCount: 0,
    chunkCount: 0,
    failedDocumentCount: 0,
    processingDocumentCount: 0,
  };
}

function safeFilename(raw: string): string {
  const value = raw.normalize("NFKC").replace(/[\\/\0]/g, "_").trim();
  if (!value) throw new Error("The uploaded Vector Document needs a filename.");
  return value.slice(0, 500);
}

function safeFolderName(raw: string): string {
  const value = raw.normalize("NFKC").trim();
  if (
    !value
    || value === "."
    || value === ".."
    || value.includes("/")
    || value.includes("\\")
    || value.includes("\0")
  ) {
    throw new Error("Vector Folder names cannot be empty or contain path separators.");
  }
  if (value.length > 240) throw new Error("Vector Folder names may not exceed 240 characters.");
  return value;
}

function joinPath(parentPath: string, name: string): string {
  return parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
}

function safeDirectoryPath(raw = "/"): string {
  const segments = raw
    .normalize("NFKC")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new Error("The Vector Document directory path is invalid.");
  }
  const path = segments.length ? `/${segments.join("/")}` : "/";
  if (path.length > 2_000) throw new Error("The Vector Document directory path is too long.");
  return path;
}

function validateUpload(filename: string, mediaType: string, size: number): void {
  if (size < 1 || size > MAX_DOCUMENT_BYTES) {
    throw new Error("Vector Documents must be between 1 byte and 25 MiB.");
  }
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (!ACCEPTED_EXTENSIONS.has(extension) && !mediaType.startsWith("image/")) {
    throw new Error("Unsupported Vector Document. Upload PDF, Office, HTML, Markdown, text, or an image.");
  }
}

function documentIdentifier(filename: string): string {
  const slug = filename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "document";
  return `${slug}-${randomUUID().slice(0, 8)}`;
}

function advisoryKey(value: string): number {
  return createHash("sha256").update(value).digest().readInt32BE(0);
}

function mediaTypeFromFilename(filename: string): string {
  const extension = filename.toLowerCase().split(".").pop();
  const types: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    html: "text/html",
    htm: "text/html",
    md: "text/markdown",
    txt: "text/plain",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  return extension ? types[extension] ?? "application/octet-stream" : "application/octet-stream";
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 4_000);
}
