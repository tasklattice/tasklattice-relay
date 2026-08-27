# ADR 0001: Project Durable Memory with self-hosted Hindsight

- Status: Accepted
- Date: 2026-08-27
- Owners: Relay Control, Runtime, and Platform

## Context

Relay currently exposes an Instance-scoped `Memory` configuration. For
OpenClaw it controls files such as `MEMORY.md` and optional local hybrid
search; Hermes does not receive an equivalent durable store. That model makes
memory part of a replaceable runtime and cannot support retention across Agent
Instance deletion or rebinding.

The product needs a Project-owned Durable Memory resource that is independent
from Agent runtime lifecycles, isolated between Projects, available to Hermes
and OpenClaw, and operable without giving runtimes a provider-wide credential.

## Decision

1. `Memory` becomes a first-class Project resource in the Relay control-plane
   database. Agent Instances bind to a Memory; they do not own it.
2. A V1 Agent Instance has exactly one active primary Memory binding, and a
   Memory has at most one active primary binding. Detached bindings remain as
   lifecycle history.
3. Creating an Agent creates a new Memory by default. An advanced creation path
   may bind an existing unbound Memory. Deleting an Agent detaches the binding
   but retains the Memory. Memory deletion is a separate dangerous operation.
4. The default provider is a self-hosted, version-pinned Hindsight deployment.
   Each Relay Memory maps to one isolated Hindsight bank. Relay stores the bank
   identifier as an opaque provider reference and owns every provider call.
5. Hindsight uses PostgreSQL/pgvector already operated by the chart, but with a
   dedicated database role and schema. Schema migration is run by one explicit
   migration job; API replicas do not race migrations at startup.
6. Hindsight reaches the existing OpenAI-compatible LiteLLM gateway for LLM,
   embedding, and reranking. Provider credentials stay in Kubernetes Secrets.
7. Relay code depends on a typed `MemoryProvider` interface. Hindsight-specific
   request shapes remain inside the adapter. Content is projected into stable
   Relay types: Conversation, Fact, Experience, Insight, and Summary.
8. Runtime recall is fail-open and bounded by a short timeout. Retain writes are
   asynchronous through a durable, idempotent outbox with retry and dead-letter
   visibility.
9. A thin Memory Gateway extends the Project Runtime Bridge boundary. Runtime
   tokens fix `projectId`, `instanceId`, `memoryId`, and the provider bank. A
   runtime never receives the shared Hindsight API key and cannot select an
   arbitrary bank.
10. Raw memory content is excluded from audit records, general application
    logs, metrics labels, and traces. Audits record operation metadata and safe
    diffs only. Secret/credential patterns are rejected or redacted before
    retain, and high-risk provider defenses remain enabled.
11. Hindsight provider refs are operational identifiers, not user-facing API
    fields. Public URLs and payloads use Relay Memory IDs only.

## Provider baseline

The initial deployment target is Hindsight `v0.9.2`. Before the Phase 2 image
pin is merged, the release digest and the exact migration command must be
verified against the published image. Relevant upstream documentation:

- <https://hindsight.vectorize.io/developer/installation>
- <https://hindsight.vectorize.io/developer/configuration>
- <https://hindsight.vectorize.io/developer/monitoring>
- <https://hindsight.vectorize.io/concepts/memory-banks>
- <https://github.com/vectorize-io/hindsight/releases/tag/v0.9.2>

## Consequences

- Agent create/delete becomes a coordinated lifecycle operation involving
  Memory provisioning or binding and compensating cleanup.
- Memory status is explicit (`PROVISIONING`, `READY`, `DEGRADED`, `DELETING`,
  `DELETED`, `ERROR`) and must not be inferred from provider reachability.
- Provider outages do not make an Agent runtime unavailable, but recall may be
  absent and retain backlog may grow. Operators need backlog, latency, error,
  and provisioning/deletion metrics.
- Hindsight upgrades require an explicit chart version change, migration
  compatibility review, backup/restore test, and rollback notes.
- A future provider can be added without changing REST or runtime contracts if
  it passes the shared provider contract suite.

## Rejected alternatives

- Keeping memory inside each Agent sandbox: replacement and deletion would
  destroy or orphan the user's durable context.
- Letting runtimes call Hindsight with the shared API key: Hindsight's built-in
  bearer key is not bank-scoped, so a compromised runtime could attempt
  cross-Memory access.
- Reusing Vector Database as Memory: knowledge retrieval and evolving Agent
  memory have different ownership, lifecycle, curation, and write semantics.
- Synchronous retain on the response path: provider latency or failure would
  unnecessarily affect interactive Agent availability.
