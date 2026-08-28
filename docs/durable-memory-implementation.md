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
- [x] Phase 4: runtime gateway, Hermes/OpenClaw hooks, fail-open recall and retain capture.
- [x] Phase 5: complete REST API, RBAC, audit-safe projections and server pagination.
- [x] Phase 6: Memory console and Agent lifecycle UI with complete state coverage.
- [x] Phase 7: threat model, observability, 16 end-to-end scenarios, runbooks and rollback.

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

## Phase 4 completion record

- Added a signed runtime credential scoped to one Project, coordinator Instance,
  and Durable Memory. Runtime recall/retain requests cannot choose a Memory,
  provider Bank, or Project; forged and legacy-unscoped credentials receive the
  same access-denied response as a missing binding.
- Added the Relay Memory Gateway to the existing Project Runtime Bridge. Recall
  has a configurable latency budget and fails open while marking provider health
  degraded. Recalled text is fenced as untrusted background context and cannot
  change Runtime Policy, Access Policy, tools, or credentials.
- Retain is never performed on the synchronous response path. OpenClaw and
  Hermes send sanitized turns to the Gateway, which encrypts and enqueues one
  idempotent outbox event for the existing worker. Secret, authorization, cookie,
  database URL, email, phone, and prompt-boundary markers are filtered before
  durable storage or provider delivery.
- Added the OpenClaw plugin using its supported `before_prompt_build` and
  `agent_end` hooks. The plugin prepends bounded recall context and submits a
  fire-and-forget retain event after the final turn.
- Added the Hermes `MemoryProvider` plugin against the pinned Nemoclaw Hermes
  `v0.0.114` ABI. `prefetch` performs fail-open recall and `sync_turn` schedules
  bounded background retain. A build-time verifier imports the provider inside
  the pinned image and exercises both Gateway calls.
- Runtime replacement keeps the same Relay Memory ID and opaque provider
  reference. Automated coverage exercises OpenClaw to OpenClaw, OpenClaw to
  Hermes, and Hermes to OpenClaw continuity without creating a second Bank.
- Verification: Control runtime tests passed (2 files / 13 tests); Runner hook
  and bootstrap tests passed (3 files / 42 tests); Hermes host tests passed
  (2 tests); Control and Runner typechecks passed; both pinned runtime wrapper
  images built; the Hermes in-image ABI/recall/retain verifier passed; Helm lint,
  resource validation, OpenShift arbitrary-UID validation, and `git diff
  --check` passed.

## Phase 5 completion record

- Added the complete Project-scoped REST surface for Memory resources,
  bindings, overview/activity/settings, Conversations, Facts, Experiences,
  Insights, evidence detail, curation, exports, and outbox administration.
  OpenAPI contracts cover every route and use the existing problem response
  model for stable provider, conflict, validation, and rate-limit errors.
- Added opaque stable cursors and server-side query, status, source-document,
  and Conversation time filtering. Resource counts come from the provider and
  the Relay projection rather than UI fixtures or cached demonstration values.
- Added optimistic Fact and structured Experience revision, status overlays for
  provider-derived Insights, evidence-aware Conversation deletion, and stable
  re-extraction idempotency. Invalidated content stays auditable and restorable
  while normal recall excludes it.
- Added Relay-owned sanitized JSON export with actor/Project/Memory-scoped
  short-lived HMAC grants. Provider credentials, opaque provider references,
  secrets, and outbox ciphertext are excluded; authorization and download are
  separately audited.
- Added database-backed operation budgets for dangerous deletion, export, and
  outbox replay. Every route is admitted by Project ownership and the existing
  capability model. Built-in role catalog revision 3 grants Developer curation
  and export, End user content read, and Auditor read-only content access while
  preserving the product mutation boundaries.
- Verification: Memory governance/provider/export tests passed (9 files / 52
  tests); contract, authorization, audit, and response tests passed (5 files /
  45 tests); Control typecheck and exact OpenAPI/route coverage passed. After
  the role revision and sanitizer assertions were finalized, the focused role,
  audit, and provider contract suite passed (3 files / 27 tests).

## Phase 6 completion record

- Added the Project Memory resource list and five-tab detail console using the
  existing shadcn components, typography, spacing, colors, and rounded surfaces.
  All counts, lists, filters, cursors, activity, health, and binding data come
  from the Project-scoped REST API.
- Added Conversation, Fact, and Experience right-side Sheets with evidence,
  redact/delete/re-extract, edit, invalidate/restore, and optimistic-conflict
  recovery. The Experience Sheet preserves the required Summary, Situation,
  Goal, Actions, Outcome, Lesson learned, and Source evidence order and expands
  to full width on small screens.
- Added Agent-create selection for a new or reusable Memory, the Agent-delete
  preservation notice and retained-Memory link, admin-only Settings/Danger
  actions, role-aware navigation, feature-flag hiding, loading skeletons, empty
  and error recovery, degraded/deletion-failed banners, pagination, focus-visible
  controls, 44-pixel action targets, and reduced-motion behavior.
- Automated component, routing, permission, source, and populated-Sheet gates
  pass. The authenticated local OrbStack release gate exercised Memory create,
  list/detail navigation, all five tabs and empty states, Settings health and
  masked provider details, rename, typed-name deletion, Agent-create new/reuse
  choices, and desktop/mobile layouts at `http://localhost:38080/proj1/memory`.
  The Vibe Designing release-gate review scored 8.6/10 with no blocker; the
  compact tab rail remains horizontally scrollable and Sheets use full width on
  small screens. Browser QA exposed a PostgreSQL advisory-lock `void` result
  that Prisma could not deserialize. The query now casts the lock result to a
  supported type; the local image rollout, live delete retry, health check, and
  focused repository test all passed. The temporary QA Memory was deleted.
- OrbStack revision 22 runs the locally built development Control, Runner,
  OpenClaw, and Hermes images with PostgreSQL, LiteLLM, Docling, and the pinned
  Hindsight API ready. The authenticated browser gate used a local-only QA
  embedding endpoint because this workstation has no configured local embedding
  model; the pinned Hindsight live integration suite remains the provider-level
  production contract evidence.

## Phase 7 completion record

- Added a default-on environment/Project feature flag. An allowlist supports
  gradual rollout; disabling new Memory traffic hides navigation and returns a
  generic not-found response while existing bound runtime credentials continue
  to serve already-running Agents.
- Added authenticated low-cardinality Prometheus metrics for Memory and binding
  states, recall/retain outcomes and latency, provider health, lifecycle
  failures, and outbox backlog/age/retry/dead-letter state. Optional
  ServiceMonitors collect Relay, Control Worker, Hindsight API, and the optional
  Hindsight worker without exposing Project, Memory, Bank, or content labels.
- Added actionable Prometheus rules for backlog count/age, provider
  unavailability, recall/retain failure rates, deletion failure, Hindsight
  asynchronous failures, and no-facts extraction. Prometheus ingress is limited
  by configurable namespace and Pod selectors.
- Hardened recursive structured-log sanitization for authorization, cookies,
  database URLs, keys, credentials, nested errors, arrays, and cycles. Hindsight
  full LLM tracing, 4xx prompt dumps, and Bank-ID metric labels remain disabled.
- Project deletion now detaches active Memory bindings, idempotently recovers a
  provisioning Bank when necessary, verifies every provider Bank is absent, and
  leaves the Project cleanup tombstone retryable when the provider is down.
- Added deployment/rollout, monitoring/alerting, backup/restore,
  upgrade/rollback, troubleshooting, uninstall/data-deletion, and threat-model
  runbooks. Runtime provider settings remain operator-managed and are audited by
  the deployment system instead of exposing a root-credential mutation API.
- Added `npm run test:durable-memory:acceptance`, which repeats all 16 required
  scenarios across 189 focused Control tests, 10 Runtime tests, the pinned real
  Hindsight API/worker and pgvector integration, manifest/OpenShift validators,
  the 66-migration seeded upgrade path, and a production Memory mock scan.
- Final repository regression: `npm run typecheck` passed; `npm test` passed
  Control 614 tests (one skipped), Runner 61, and example MCP 5; `npm run build`
  passed; Vendor Skill packaging, Helm dependency preparation, base/development
  lint, resource, OpenShift, air-gap, and development-default validators passed.
  The Control test timeout is 15 seconds so database-heavy tests remain stable
  under the full suite's parallel load.
