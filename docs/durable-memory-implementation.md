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
- [ ] Phase 2: Hindsight chart resources, provider adapter, live integration tests.
- [ ] Phase 3: Memory lifecycle, binding, deletion, worker recovery, Agent compensation.
- [ ] Phase 4: retain outbox, runtime gateway, Hermes/OpenClaw hooks, fail-open recall.
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
