# Durable Memory operations

This runbook covers Relay-owned Durable Memory and the bundled self-hosted
Hindsight provider. The reviewed provider is pinned in `charts/tali-relay` to
Hindsight `0.9.2-slim` by OCI digest. Relay is the only product access boundary;
Hindsight remains a cluster-internal service.

## Configuration and gradual rollout

| Setting | Purpose | Production guidance |
| --- | --- | --- |
| `features.durableMemory.enabled` | Environment-wide default | Keep enabled for normal installs; set false for an emergency UI/API freeze |
| `features.durableMemory.projectAllowlist` | Project rollout list | When non-empty, only these Project IDs can create/use new Durable Memory |
| `hindsight.runtimeRecallTimeoutMs` | Agent recall latency budget | Recall fails open after the budget; tune from p95 rather than increasing blindly |
| `monitoring.serviceMonitor.enabled` | Relay, Control Worker, and Hindsight scrapes | Enable only when the Prometheus Operator CRDs exist |
| `monitoring.networkPolicy.*Selector` | Prometheus namespace/Pod ingress identity | Match the actual Prometheus installation before enabling scraping |
| `monitoring.prometheusRule.enabled` | Actionable Memory alerts | Enable with ServiceMonitor and route the warning/critical severities |
| `secrets.metricsToken` / `metrics-token` | Bearer token for Relay metrics | Generate independently and rotate as a Secret; never reuse the Hindsight root key |

An explicit Project allowlist takes precedence over the environment default.
Disabling the flag removes Memory navigation and rejects new Project Memory API
traffic with a generic 404. Existing bound runtime credentials and Agent paths
continue to work so a rollout change does not break running Agents.

For `secrets.existingSecret`, add `metrics-token` together with the Hindsight
keys documented in the chart README. The Control and Control Worker processes
read it only from a Secret reference.

## Metrics and alerts

Relay exposes authenticated Prometheus text endpoints at `/api/metrics` and the
Control Worker `/metrics`; Hindsight exposes its internal `/metrics` endpoint.
The optional ServiceMonitors configure all three. Relay metrics never use
Project, Memory, provider Bank, Conversation, or content fields as labels.

| Signal | Metric |
| --- | --- |
| Memory lifecycle totals | `tali_memory_resources{status}` |
| Active bindings and reusable unbound Memories | `tali_memory_bindings{state}` |
| Recall outcome and latency | `tali_memory_recall_total`, `tali_memory_recall_duration_seconds` |
| Retain delivery outcome and latency | `tali_memory_retain_total`, `tali_memory_retain_duration_seconds` |
| Outbox backlog, age, retry, dead letter | `tali_memory_outbox_backlog`, `tali_memory_outbox_oldest_event_age_seconds`, `tali_memory_outbox_retries_total`, `tali_memory_outbox_dead_letters_total` |
| Provider health | `tali_memory_provider_health{status}` |
| Provisioning/deletion failures | `tali_memory_lifecycle_failures_total{operation}` |
| Hindsight extraction/observation work | `hindsight_operation_total`, `hindsight_async_operations`, `hindsight_retain_documents_total` |
| Provider token usage, without content | `hindsight_llm_tokens_input_total`, `hindsight_llm_tokens_output_total` |

Example PromQL:

```promql
histogram_quantile(0.50, sum by (le) (rate(tali_memory_recall_duration_seconds_bucket[5m])))
histogram_quantile(0.95, sum by (le) (rate(tali_memory_recall_duration_seconds_bucket[5m])))
sum(rate(tali_memory_recall_total{outcome="success"}[5m]))
  / clamp_min(sum(rate(tali_memory_recall_total[5m])), 0.001)
```

The chart's PrometheusRule covers outbox count/age, Provider unavailability,
recall and retain failures, verified deletion failures, failed Hindsight async
work, and a high share of retained documents that produced no facts.

### Alert response

- **Outbox backlog or oldest age:** check Hindsight readiness, its PostgreSQL
  connection, and Control Worker readiness. Restore connectivity before
  replaying dead-letter rows; provider idempotency prevents duplicate
  Conversations.
- **Provider unavailable or recall failures:** check the internal Service,
  Hindsight API logs, database pool metrics, and LiteLLM aliases. Agent
  inference continues because recall is fail-open.
- **Retain or async-operation failures:** inspect Hindsight operation and worker
  metrics. Reprocess only affected Conversations after the underlying model or
  database issue is fixed.
- **Deletion failure:** keep the Relay tombstone. Restore provider access and
  retry; success is shown only after Hindsight verifies the Bank is absent.

Hindsight can emit full prompts/completions when OpenTelemetry tracing is
enabled. The chart deliberately keeps LLM tracing and 4xx debug dumps disabled.
Do not enable them in production without an approved content-redaction and
retention policy.

## Daily operations

- A degraded Memory remains visible with its safe error summary. Use Provider
  Settings to confirm health, then use Retry for provisioning failures.
- Agent deletion detaches the binding and leaves the Memory `unbound`; rebind
  that same Memory during a later OpenClaw or Hermes Agent creation.
- A dead-letter outbox row may be replayed by an authorized administrator after
  the provider is healthy. Replay is rate-limited and audited.
- A `deletion_failed` Memory is not reusable. Retry deletion rather than
  creating an untracked provider-side Bank.
- Project deletion first destroys Agent runtimes, detaches active bindings,
  and verifies every provider Bank is absent. The Project tombstone and cleanup
  task remain retryable until this and the remaining external cleanup finish.

## Backup and restore

Back up both data owners together:

1. Relay control-plane PostgreSQL schema/database, including `memories`,
   bindings, curation events, encrypted outbox rows, and audit logs.
2. The dedicated Hindsight database/schema, including pgvector data.
3. The deployed Relay revision, Hindsight image digest, embedding dimensions,
   and LiteLLM alias mapping. Store Secret material in the secret manager, not
   in the database backup manifest.

For a transactionally consistent maintenance backup, pause new Agent traffic,
scale Control Worker and Hindsight workers to zero, wait for active provider
operations to finish, then take database-native snapshots/dumps. Resume the API
only after both snapshots have completed. A storage-level snapshot may be used
when PostgreSQL guarantees consistency across both databases.

To restore, stop Control, Control Worker, Hindsight API, and workers; restore
both databases from the same recovery point; restore the matching Secrets;
then run the reviewed Hindsight migration Job and Prisma migrations before
starting workers and APIs. Verify `/api/health`, Hindsight `/health`, a known
Memory detail request, recall, and one idempotent retain before reopening Agent
traffic. Never restore only Relay or only Hindsight and declare success: their
opaque provider references must describe the same recovery point.

## Upgrade and rollback

1. Back up both databases and record the current image/client versions.
2. Review the fixed Hindsight release notes and configuration reference. Update
   the image digest and `@vectorize-io/hindsight-client` together.
3. Run the repository's live Hindsight integration test against the proposed
   image and embedding dimension.
4. Run Helm manifest, OpenShift, air-gap, migration, integration, and E2E
   validation.
5. Deploy with `helm upgrade --wait --wait-for-jobs`; the single migration Job
   runs before the Hindsight API application wave.

Control-plane migrations are additive. After Memory traffic exists, prefer a
forward-fix release and never apply a destructive down migration. If a
Hindsight schema migration is not backward compatible, do not start an older
binary against it. A full rollback requires stopping all writers and restoring
both coordinated database backups plus the matching application revisions.

## Uninstall and complete data deletion

Before uninstalling a production release, schedule Project deletion for every
Project and wait until each cleanup task is complete; this verifies provider
Banks are absent rather than merely removing Relay rows. Export only data that
policy permits before deletion.

`helm uninstall` removes workload objects but is not proof that PostgreSQL
PVCs, snapshots, external databases, object-store payload references, or
secret-manager values are erased. After uninstall, an operator must separately
apply the organization's approved deletion procedure to the exact release
namespace's PVCs/snapshots, both PostgreSQL databases, referenced payloads, and
Secrets. Verify those explicit targets before deletion and retain only the
content-free audit/tombstone evidence required by policy.

## Troubleshooting

| Symptom | Check | Safe action |
| --- | --- | --- |
| Agent answers but has no recalled context | Recall outcome/latency and Memory status | Restore provider health; do not fail the Agent request |
| Outbox grows | Control Worker readiness, Hindsight readiness, retry/dead-letter gauges | Fix dependency, then replay audited failures |
| Recall latency rises | Relay and Hindsight p95, DB pool, reranker/LLM latency | Tune provider capacity or the bounded timeout |
| Retain succeeds but recall finds nothing | `hindsight_retain_documents_total{outcome="no_facts"}` | Review retain mission/model, then re-extract the Conversation |
| Memory cannot be deleted | Active binding or `deletion_failed` status | Detach first; retry only after provider access is restored |
| Memory UI disappears after rollout | Environment flag and Project allowlist | Add the Project deliberately; running bound Agents remain intact |
