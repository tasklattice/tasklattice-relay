# TaskLattice Relay modular testing strategy

## Decision

Relay keeps the useful L0-L4 layering from the prior test proposal, but PR
selection follows the repository's actual components. A change runs the direct
module tests plus a downstream Agent golden path when the changed component is
part of that journey. Full-cluster and live-model checks remain separate from
normal PR CI.

| Layer | Evidence | PR policy |
| --- | --- | --- |
| L0 static/configuration | TypeScript, migrations, Helm render and policy validators | Affected component on every PR |
| L1 unit | Pure domain, schema, permission, transformation and UI behavior | Affected module on every PR |
| L2 component/contract | PostgreSQL-compatible test store, provider fixtures, runtime bridges and deterministic A2A | Affected module on every PR |
| L3 cluster smoke | Helm install, probes, jobs, RBAC and one representative runtime | Relevant infrastructure changes and `main` |
| L4 live golden path | Real provider inference, embedding, document ingestion and Hermes chat | Manual only |

The attachment is directionally right about these layers. Its inventory is not
the current source of truth, however: Relay currently exposes Hermes, OpenClaw
and DeepAgents, and its current authorization model is capability- and
relationship-based rather than a fixed set of four Keycloak test users. Running
an empty cluster and every real provider on every PR would also make ordinary
changes expensive and flaky.

## Test blocks and module rows

The canonical mapping lives in
`scripts/testing/test-modules.mjs`. Its first division is the block (`block`),
and its second division is the executable module row. Configuration validation
fails when a production source has no explicit owner, a deterministic test is
not assigned, or a module row resolves no test evidence. The broad Control
fallback remains a second safety net for newly added paths.

| Block | Module row | Required evidence |
| --- | --- | --- |
| Control plane | `access` | Local auth, SSO/OIDC, external role binding, role switching, capabilities, Access Policies, Projects and embedded Keycloak rendering |
| Control plane | `inference` | Provider adapters, model discovery/validation, Model Routing, LiteLLM permissions, quota and cost ingestion |
| Control plane | `agent-lifecycle` | Agent create/provision/delete, Worker queues/retries, Kubernetes reconciliation, runtime policy, TTY and interaction authorization |
| Control plane | `memory` | Hindsight HTTP contract, provider lifecycle, outbox, recall/retain, governance, redaction and runtime binding |
| Control plane | `knowledge-a2a` | Docling parse, chunk and embedding pipeline, Vector search, Agent Garden Registry, A2A discovery/call contracts |
| Control plane | `observability` | Audit, Runs, runtime telemetry, overview and trace presentation |
| Control plane | `control-ui` | Shared UI, HTTP/OpenAPI contracts, route wiring, navigation and client helpers |
| Data plane | `openshell-isolation` | Per-Project Namespace/Gateway ownership, route scoping, workspace-qualified state and cross-tenant rejection |
| Data plane | `runtime` | Hermes, OpenClaw and Deep Agents image/bootstrap/health/terminal definitions and startup paths |
| Data plane | `runtime-integrations` | Hermes A2A, Knowledge, Durable Memory and telemetry plugins plus authenticated Dashboard HTTP/WebSocket proxy |
| Cross-block acceptance | `agent-golden-path` | Deterministic L2 orchestration plus the explicit live L4 Hermes journey; it is downstream of both blocks, not a third block |

Shared contracts, Prisma migrations, test fixtures, package locks and the module
map select every module. Documentation-only changes select no test module.
Workspace typecheck/build jobs remain component-level because TypeScript and
Vite compile the workspace as a single graph; only test execution is split at
the domain boundary.

Run a module locally with:

```bash
npm run test:module -- memory
```

Validate path selection itself with:

```bash
npm run test:modules:config
```

## Core golden path

The deterministic L2 golden path must prove one coherent journey without a
network model call:

1. Create and provision a Hermes Agent with an active Access Policy, a READY
   Model Routing, a registered Vector Database and a Project Memory.
2. Confirm the Agent key is limited to its Routing and selected Vector Database.
3. Search the registered Vector Database through the Hermes runtime boundary.
4. Discover a READY A2A peer and complete a bounded delegation round-trip.
5. Retain the user, tool and assistant messages from that round-trip into the
   Agent's fixed Project Memory and deliver the outbox once.
6. Confirm configuration reads do not disclose the Hermes interaction URL while
   the dedicated interaction capability does.
7. Delete the Agent, complete asynchronous runtime cleanup, and prove the Memory,
   provider Bank and retained conversation still exist as unbound data.

This test does not claim that a real LLM selected tools correctly. It proves the
Relay orchestration and security contracts around the runtime. Actual Hermes
chat/tool selection belongs to the live L4 test below.

The manual L4 entry is `npm run test:e2e:live`. It refuses to run unless
`TALI_LIVE_E2E=1`, and performs one disposable, evidence-bearing journey:

1. Select a READY Routing, ACTIVE Access Policy, registered PostgreSQL Vector
   Database and callable A2A peer.
2. Upload one tiny Markdown document; wait for Docling parsing, chunking and
   embedding; then prove semantic search returns its random marker.
3. Create a real Hermes Agent and prove the Relay TTY emits a runtime frame.
4. Exchange the one-time Hermes Dashboard URL for its HttpOnly session, open
   the independent `/chat` UI and drive its real `/api/pty` WebSocket.
5. Require structured start and completion evidence for `a2a_list`, `a2a_call`,
   `vector_database_list` and `vector_database_search`; require the A2A result
   to return `ok=true`.
6. Poll the configured Memory provider until the first turn is retained, then
   open a fresh Hermes Chat session and prove the marker is recalled.
7. Prove the one-time Dashboard URL cannot be replayed and unauthenticated
   interaction access is rejected, then remove disposable resources.

`npm run test:e2e:runtime-matrix` separately starts OpenClaw and Deep Agents on
the deployed OpenShell data plane and validates their Web UI/TTY shape. Hermes
is not duplicated there because L4 already validates its startup, TTY, Chat,
model inference and runtime integrations.

## Historical regression inventory

The following failures are explicitly assigned to modules and retained as
regression coverage:

| Regression | Primary evidence |
| --- | --- |
| A queued Agent was marked failed by an early Runner `NOT_FOUND` | `agent-lifecycle` reconciliation tests |
| Delete returned before cleanup, or cleanup revoked billing evidence incorrectly | `agent-lifecycle` lifecycle tests |
| Agent deletion removed its Memory/Bank, or replacement created a second Bank | `memory` plus `agent-golden-path` |
| Runtime callers forged Project, Instance, Memory or Bank selectors | `memory` bridge isolation tests |
| Secrets/PII entered Memory provider payloads or runtime logs | `memory` redaction and `observability` tests |
| Hermes persisted a literal provider credential instead of an OpenShell placeholder | `runtime` bootstrap tests |
| Hermes Dashboard token replay or hostile WebSocket Origin bypassed access | `runtime` Web UI proxy tests |
| CONFIG_VIEW leaked an interaction credential | `agent-lifecycle` HTTP view and `access` capability tests |
| A2A accepted invalid cards, non-JSON or oversized responses | `knowledge-a2a` contract tests |
| Knowledge access was not reflected in LiteLLM object permissions | `agent-lifecycle` and `agent-golden-path` |

## Live-model cost and secret policy

`DEEPSEEK_API_KEY` and `NVAPI_API_KEY` are never read by PR module tests, the
runtime startup matrix, or automatic release validation. No secret value,
prefix or length is logged. The live workflow is `workflow_dispatch` only and
uses the deployment's preconfigured READY Routing; the test process does not
copy provider keys into Agent configuration or output. This keeps the GitHub
Secrets available for deployment/provider setup without exposing them to every
test job.

The live budget is deliberately fixed:

- exactly two user turns: one bounded tool-use turn and one short fresh-session
  Memory recall turn; there is no provider/model matrix;
- one tiny Markdown document for chunking/embedding and one semantic query;
- only a `SINGLE` Routing with no fallback deployments is accepted; its retry
  count must stay within `TALI_LIVE_E2E_MAX_ROUTING_RETRIES` (default `2`);
- deterministic, concise prompts, and no test-harness retry of a model turn;
- no direct fallback from the configured Routing to the other GitHub API key;
- no scheduled regression until a dedicated disposable cluster and budget
  threshold are configured.

L4 acceptance is: Hermes becomes READY, its authenticated Chat surface works,
the model produces bounded responses, Hermes invokes the expected A2A and
Vector tools with structured event evidence, the resulting conversation reaches
Memory, and unauthorized interaction access remains denied. Cross-Project
OpenShell identity is enforced by the `openshell-isolation` module. Missing
deployment credentials or cluster access is `BLOCKED`, never converted to a
passing mock.
