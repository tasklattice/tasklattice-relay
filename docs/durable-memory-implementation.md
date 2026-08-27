# Project Durable Memory implementation map

## Product intent

Durable Memory is a Project-level resource that survives Agent Instance
replacement. A user can create, inspect, curate, rebind, and explicitly delete
Memory without treating a runtime filesystem or a Vector Database as the source
of truth.

## Existing ownership boundaries

| Concern | Existing implementation | Durable Memory integration |
| --- | --- | --- |
| Project and Agent lifecycle | `apps/control/server/instances`, `ProjectStore`, Prisma `AgentRecord` | Add Memory records and primary binding orchestration; Agent deletion detaches only |
| Durable work | pg-boss Control Worker in `apps/control/server/jobs` and `workers` | Provision/delete provider banks and drain retain outbox |
| Runtime identity | Project Runtime Bridge signed Project and Coordinator tokens | Extend claims and routes with fixed Memory and provider-bank scope |
| Runtime bootstrap | `apps/runner` adapters for Hermes and OpenClaw | Inject only the scoped Relay Memory Gateway endpoint/token |
| API and authorization | Nitro project routes, contracts, capability admission, built-in `CAP_AGENT_MEMORY_*` capabilities | Add `/memories` resources and map every action to an existing or explicit capability |
| Audit | request audit plugin and route descriptors | Record Memory operation metadata; suppress retained/recalled content and secrets |
| UI | Project Memory route, Agent create/delete sheets, shadcn-based console | Replace Instance-local configuration with Memory list/detail/curation and binding choices |
| Deployment | `charts/tali-relay`, PostgreSQL/pgvector, LiteLLM, NetworkPolicies | Add pinned Hindsight API/migration resources, dedicated DB identity, internal-only service |

The Vector Database file browser and retrieval implementation remains an
independent Project capability and is not structurally replaced by this work.

## Delivery phases

- [x] Phase 0: repository map, baseline, and architecture decision.
- [x] Phase 1: domain schema, migration, state machine, provider contract, fake provider.
- [x] Phase 2: Hindsight chart resources, provider adapter, live integration tests.
- [x] Phase 3: Memory lifecycle, binding, deletion, worker recovery, Agent compensation.
- [ ] Phase 4: runtime gateway, Hermes/OpenClaw hooks, fail-open recall and retain capture.
- [ ] Phase 5: complete REST API, RBAC, audit-safe projections and server pagination.
- [ ] Phase 6: Memory console and Agent lifecycle UI with complete state coverage.
- [ ] Phase 7: threat model, observability, 16 end-to-end scenarios, runbooks and rollback.

## Phase 0 baseline

Baseline revision: `7b2cd40` (`feat(control): expand vector database file management`).

Recorded on 2026-08-27 before Durable Memory changes:

| Command | Result |
| --- | --- |
| `npm test` | Passed: Control 105 files / 524 tests; example MCP 2 / 5; Runner 6 / 56 |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `helm lint charts/tali-relay` | Passed (icon recommendation only) |
| `helm lint charts/tali-relay -f charts/tali-relay/values-dev.yaml` | Passed (icon recommendation only) |

## Acceptance invariant inventory

- Project IDs must be present in every Memory database key, query, route, job,
  token, and provider access decision.
- One active primary binding per Agent Instance and per Memory is enforced by
  database partial unique indexes, not only application checks.
- Detached bindings are immutable history; rebinding creates a new binding row.
- Provider create/delete/retain operations carry stable idempotency keys.
- Memory deletion is asynchronous and cannot be triggered by Agent deletion.
- Recall failure or timeout cannot fail an Agent inference request.
- Runtime credentials cannot choose a Memory or Hindsight bank.
- Audit/log/metric/trace paths never contain raw retained or recalled content.

## Migration recovery strategy

The Phase 1 migration is additive and does not rewrite existing Agent or Vector
Database rows. Before a production deploy, back up the control-plane database
and deploy the schema before enabling Memory API routes or workers. If the
application rollout fails before Memory traffic is enabled, roll back the
application and leave the empty additive tables in place; a follow-up migration
can remove them after verifying they contain no rows. Once any Memory has been
created, do not run a destructive down migration. Roll the application forward
with a corrective migration so binding history, curation evidence, and outbox
events remain available. Provider banks created during a failed rollout are
reconciled by idempotency key rather than deleted blindly.

The Phase 3 migration adds only the nullable Agent creation-idempotency key and
a Project/owner-scoped unique index. Existing Agent rows remain unchanged.
Rolling the application back may leave the nullable column and index in place;
they are backward-compatible. Once idempotent Agent requests have been served,
do not remove the index until every in-flight create request has expired.

## Phase 1 completion record

- Added Project-scoped Memory, binding, retain outbox, curation event, and
  structured Experience projection tables.
- Added database-enforced active-primary uniqueness for both Memory and Agent,
  plus idempotency constraints for create, bind, and retain events.
- Added explicit Memory and binding state machines that emit domain events and
  reject illegal transitions.
- Added stable typed content contracts and the provider interface. The Fake
  adapter lives under `server/memories/testing` and is not wired into production.
- Verified the additive migration through the empty/in-memory migration harness
  and an existing seeded Project fixture.
- Verification: `npm test` passed (Control 108 files / 551 tests; example MCP
  2 / 5; Runner 6 / 56), Control typecheck passed, and migration validation
  passed with 65 migration directories.

## Phase 2 completion record

- Pinned the self-hosted Hindsight API to `0.9.2-slim` and its reviewed
  multi-architecture OCI index digest. The production provider factory selects
  only Hindsight; the Fake remains confined to tests.
- Added a dedicated Hindsight database/user/schema bootstrap plus an ordinary,
  version-and-dimension-scoped migration Job. API startup migrations are off,
  and Relay never reads or writes Hindsight tables.
- Routed Hindsight LLM, embedding, and reranker aliases through the existing
  LiteLLM Service and Secret. API-key tenancy is enabled; MCP, full LLM trace,
  4xx prompt dumps, and public provider exposure are disabled.
- Added internal API/optional worker Services, probes, PDBs, resource bounds,
  read-only root filesystems, tokenless ServiceAccount, least-egress
  NetworkPolicies, OpenShift arbitrary-UID rendering, and air-gap image mirrors.
  The built-in worker remains the default until load testing justifies the
  optional StatefulSet.
- Added SDK-level HTTP integration tests and a repeatable live test that starts
  the pinned Hindsight image, pgvector PostgreSQL, a deterministic test-only
  embedding endpoint, API, and external worker. Migration/API/worker run with
  arbitrary high UIDs; the test covers Bank create, async retain idempotency,
  operation completion, recall, server paging, invalidate/restore,
  Conversation deletion, health, and verified Bank deletion.
- Hindsight `0.9.2` emits guidance suggesting `reranker=none`, but its runtime
  rejects that value; the live harness uses its supported `rrf` provider. The
  production chart uses the supported `litellm` provider and is unaffected.
- Verification: `npm run typecheck --workspace @tali/control` passed;
  targeted provider tests passed (3 files / 7 tests);
  `npm run test:hindsight:integration` passed (1 live test);
  resource, OpenShift, disconnected, and development-default Helm validators
  passed; base and development Helm lint passed.

## Phase 3 completion record

- Added the Project-scoped `MemoryService` lifecycle boundary. It provisions a
  provider Bank with a stable key, validates and creates primary bindings,
  detaches without touching provider content, supports cross-runtime rebinding,
  and runs verified deletion through `deleting` / `deletion_failed` / `deleted`.
- Added a database creation-idempotency key for Agent requests. The Instances
  endpoint accepts `Idempotency-Key`; repeats return the same Agent, Memory,
  binding, and provider Bank rather than creating parallel resources.
- Wired OpenClaw and Hermes Agent creation to automatically provision and bind
  Durable Memory. `durableMemoryId` selects an existing ready/unbound Memory.
  Failed Agent acceptance rolls back the binding and compensates a newly
  created Bank; existing Memory is returned to `unbound`.
- Wired background Agent deletion to detach the primary binding only after
  runtime cleanup. The Memory becomes `unbound`, the Bank remains present, and
  detached binding history remains queryable.
- Serialized bind versus dangerous-delete decisions with Project/Memory-scoped
  PostgreSQL transaction advisory locks. Provider deletion is never reported as
  successful until the adapter verifies the Bank is absent.
- Added AES-256-GCM retain envelopes authenticated to Project, Memory, and
  idempotency key. The scheduled Control Worker claims due/stale outbox rows,
  retries with bounded exponential delay, recovers degraded Memory, dead-letters
  terminal work, and supports explicitly audited replay. Provider append keeps
  the same stable key, so a worker retry cannot duplicate a Conversation.
- Centralized lifecycle, binding, deletion, recovery, dead-letter, and replay
  history in safe `memory_curation_events` snapshots that contain status and
  identifiers but never retained text, provider credentials, or Bank refs.
- Verification: Contracts build and Control typecheck passed; Phase 3 targeted
  tests passed (Memory cipher/repository/service, Instance lifecycle, Control
  Worker, and OpenAPI contracts). The suite covers default auto-binding,
  Agent-create replay, Hermes rebinding, detach preservation, verified deletion,
  encrypted retry/recovery, exact-once provider append, dead letter/replay, and
  worker discovery.
