# Control-plane database

TaskLattice Relay uses Prisma ORM with PostgreSQL for all control-plane metadata.
SQLite is not supported.

## Database boundary

The control plane and LiteLLM use the same PostgreSQL instance and database:

- LiteLLM keeps its tables and migration history in `public`.
- TaskLattice Relay keeps its tables and Prisma migration history in the
  compatibility `tasklattice` schema. The stable schema name is intentionally
  not shortened because existing deployments already persist data there.
- The `vector` extension is installed in `public`. Built-in Vector
  Databases keep their metadata and chunks in `tasklattice`, alongside the
  Project boundary that owns them.
- Every Project-owned control record includes `project_id`.
- Project-scoped API routes use `/api/v1/projects/{projectId}/...`; stores apply
  that Project scope internally instead of accepting ad hoc page-level filters.

The shared instance reduces deployment and backup overhead. Separate schemas
prevent table and migration-name collisions, but do not isolate CPU, memory,
connections, storage, or failure domains. Production deployments should set
connection limits, monitor both workloads, and back up the whole database.

## Built-in Vector Databases

The `postgresql` Vector Database provider stores text chunks, JSON attributes,
and pgvector embeddings in `tasklattice.knowledge_vector_chunks`. The parent
`KnowledgeVectorDatabase` record fixes the LiteLLM embedding model and vector
dimensions for one Project-scoped Vector Database. Changing either setting is
rejected after the first chunk is stored, preventing mixed-dimensional data.

Search uses exact cosine distance initially. This gives deterministic recall
for small and medium knowledge collections and permits different embedding
dimensions across Vector Databases. Add per-database partial HNSW indexes only
after production cardinality and latency measurements justify the additional
memory, build time, and recall trade-off.

Administrators can ingest already chunked text through the Project API. Relay
calls the configured LiteLLM embedding model and upserts the resulting vectors
atomically for the batch:

```http
PUT /api/v1/projects/{projectId}/catalog/vector-databases/{databaseId}/chunks
Content-Type: application/json

{
  "chunks": [
    {
      "id": "runbook-42#rotation",
      "content": "Restart the service after rotating credentials.",
      "filename": "runbooks/credentials.md",
      "attributes": { "environment": "production" }
    }
  ]
}
```

Batches contain at most 128 chunks. Reusing a chunk ID replaces its content,
attributes, and embedding. Delete one chunk with
`DELETE .../chunks/{chunkId}`.

Project Administrators upload PDF, Office, HTML, Markdown, text, or image files
from a Vector Database detail page or through
`POST .../vector-databases/{databaseId}/documents` using a multipart `file`
field. Control validates the 25 MiB limit, persists an immutable document
revision and a durable pg-boss job, and returns HTTP 202. The Control Worker
then calls the separate Docling Serve workload. Docling performs layout-aware
parsing, table understanding, and OCR and returns HybridChunker output with
headings and page provenance. The worker calls the Vector Database's configured
Project-visible LiteLLM embedding model and activates the new revision only
after every vector is stored successfully.

Parser and embedding failures remain visible in ingestion activity and keep the
previous active revision searchable. Re-uploading the same filename allocates a
new monotonically increasing revision. Successful activation removes older
revision chunks; deleting the document cascades through its revisions, jobs,
chunks, and vectors. Recall can be verified through
`POST .../vector-databases/{databaseId}/search` or the Search Playground.

Docling is a Python service, not an in-process TypeScript dependency. The
application boundary is its HTTP API (`/v1/chunk/hybrid/file`); all ownership,
authorization, job state, embedding calls, and PostgreSQL writes stay in the
TypeScript control plane. The default Chart deploys
`ghcr.io/docling-project/docling-serve-cpu` and gives the Control Worker its
cluster-local `[worker.docling].baseUrl` in `control.toml`. Its runtime model cache is persisted without
forcing an empty offline artifacts directory. Docling OCR does not require an
NVIDIA API key.

The default Chart image includes pgvector. A custom PostgreSQL image must also
install the extension files before `prisma migrate deploy` runs; merely setting
`shared_preload_libraries` is neither necessary nor sufficient.

The default image change from PostgreSQL Alpine to the pgvector Debian image
also changes the container UID/GID from `70` to `999`. Existing persistent
volumes require a backed-up, rehearsed ownership migration during an explicit
maintenance window before the upgraded StatefulSet starts.

## Initialization

`prisma migrate deploy` is the only initialization path. The first migration
creates the schema and tables. A following idempotent SQL migration inserts:

- the local administrator, bootstrap Project, and administrator membership;
- built-in Skills, MCP servers, Vector Database registrations, specializations, and
  sandbox policies.

Helm runs migrations in the control Deployment init container before the
application starts. Better Auth owns `auth_accounts`, `auth_sessions`, and
`auth_verifications`. On first startup with Local authentication enabled, the
configured bootstrap password is hashed into a Better Auth credential account
only when that credential is missing.

New users do not receive an automatically generated Project. A Project is
created explicitly or becomes available through membership. New Projects are
initialized from the built-in resource and sandbox-policy catalogs embedded in
the Control application.

For local development:

```sh
cp control.example.toml control.toml
# Set database.url in control.toml for the local PostgreSQL instance.
export TALI_CONFIG="$PWD/control.toml"
npm run db:migrate --workspace @tali/control
npm run dev --workspace @tali/control
```
