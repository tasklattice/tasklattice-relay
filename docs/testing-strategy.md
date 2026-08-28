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
| L4 live golden path | Real provider inference, embedding, document ingestion and Hermes chat | Manual/release only |

The attachment is directionally right about these layers. Its inventory is not
the current source of truth, however: Relay currently exposes Hermes, OpenClaw
and DeepAgents, and its current authorization model is capability- and
relationship-based rather than a fixed set of four Keycloak test users. Running
an empty cluster and every real provider on every PR would also make ordinary
changes expensive and flaky.

## Component modules

The canonical mapping lives in
`scripts/testing/test-modules.mjs`. New production areas must be assigned there;
an unknown `apps/control` path intentionally falls back to all Control modules
so a new component cannot silently escape CI.

| Module | Owns |
| --- | --- |
| `access` | Authentication, authorization, Access Policies, Projects, Departments and platform settings |
| `inference` | Providers, Models, Routing, LiteLLM permissions, quota and cost ingestion |
| `agent-lifecycle` | Agent create/provision/delete, jobs, Kubernetes, runtime policy and terminal surfaces |
| `memory` | Project Memory, provider contract, outbox, recall/retain, governance and runtime binding |
| `knowledge-a2a` | Vector Databases, document ingestion, Agent Garden, A2A discovery and delegation |
| `observability` | Audit, Runs, telemetry, overview and traces |
| `control-ui` | Shared UI, HTTP/OpenAPI contracts, navigation and client helpers |
| `runtime` | Runner, Hermes/OpenClaw bootstrap, Web UI proxy and runtime plugins |
| `agent-golden-path` | One deterministic cross-component Agent journey; selected as a downstream check |

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
chat/tool selection belongs to L4.

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

`DEEPSEEK_API_KEY` and `NVAPI_API_KEY` are never read by PR module tests. No
secret value, prefix or length is logged. Live checks require an explicit manual
or release invocation and must use a fixed budget:

- at most one short chat completion for the selected generation provider;
- at most one small embedding request for the selected embedding provider;
- deterministic prompts, low output-token limits and no retry fan-out;
- no provider matrix unless a provider or routing implementation changed;
- no scheduled regression until a dedicated disposable cluster and budget
  threshold are configured.

L4 acceptance is: Hermes becomes READY, its authenticated Chat surface works,
the model produces one response, Hermes invokes the expected A2A and Vector
tools with trace evidence, the resulting conversation reaches Memory, and
cross-Project/unauthorized access remains denied. Missing deployment credentials
or cluster access is `BLOCKED`, never converted to a passing mock.
