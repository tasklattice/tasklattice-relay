# Durable Memory automated acceptance

Run the complete repeatable gate from the repository root:

```bash
npm run test:durable-memory:acceptance
```

The command runs focused Control and Runtime suites, the pinned real Hindsight
container integration, Kubernetes and OpenShift manifest checks, additive
database migration validation, and a production-source mock/fallback scan.

| # | Scenario | Automated evidence |
| --- | --- | --- |
| 1 | Automatic binding | Instance lifecycle plus Memory service tests assert one ready Memory, one active binding, and idempotent replay |
| 2 | Instance destroyed, Memory survives | Instance deletion and runtime continuity tests assert unbound Memory, Bank/content retained |
| 3 | Same-runtime rebuild | OpenClaw continuity test recalls from the unchanged Memory/Bank |
| 4 | Cross-runtime continuity | Hermes-to-OpenClaw and OpenClaw-to-Hermes service and bootstrap tests |
| 5 | Fact revision | Governance test asserts optimistic update and current recall value |
| 6 | Invalidate/restore | Provider contract and governance status-overlay tests |
| 7 | Evidence linkage | Conversation redaction/deletion tests invalidate unsupported derived items |
| 8 | Provider outage | Runtime fail-open plus encrypted outbox retry/exact-once delivery tests |
| 9 | Isolation attack | Project repository predicates, admission, and signed runtime-token forgery tests |
| 10 | Complete deletion | Bound-delete block, provider absence verification, failure retry, and Project purge tests |
| 11 | Secret exclusion | Sanitizer, provider payload, structured log/error, audit, export, metrics, and UI projection tests |
| 12 | Role UI | Built-in role, permission projection, navigation, and action visibility tests |
| 13 | State UI | SSR component tests for loading, empty, error, degraded, deletion failure, retry, conflict, and pagination |
| 14 | OpenShift | Arbitrary UID, read-only filesystem, NetworkPolicy, and minimal RBAC manifest validator |
| 15 | Upgrade compatibility | All Prisma migrations apply over the existing seeded Project/Instance fixture without destructive rewrite |
| 16 | No mock production path | Source gate rejects Fake provider or fixed Memory fallback references outside tests and verifies Hindsight-only factory |

The live Hindsight leg uses the reviewed pinned image and actual API/worker
processes with PostgreSQL/pgvector. Test-only deterministic embeddings keep the
gate repeatable; they are not linked into a production bundle.
