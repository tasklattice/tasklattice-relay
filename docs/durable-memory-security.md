# Durable Memory security model

## Trust boundaries and threats

Durable Memory spans the browser, Relay API, Control Worker, Agent runtime,
Hindsight, LiteLLM, and PostgreSQL. The primary threats are cross-Project
identifier substitution, treating a provider Bank ID as authorization,
runtime-token reuse, retained prompt injection, secret persistence, provider
SSRF/credential exposure, unsafe tracing, and incomplete deletion.

The controls are:

- Every Relay row, route, repository, job, and signed runtime claim is scoped
  to a Project. Database keys and partial unique indexes enforce one active
  primary binding for each Memory and Agent.
- Browser and administrative routes use capability admission. Runtime tokens
  are signed for one Project, coordinator Instance, and Memory; callers cannot
  submit or replace a Bank ID.
- Hindsight's root credential is read only by Control/Worker from a Secret and
  is never sent to a browser or Agent. The provider URL is operator-managed
  configuration, not user input, and defaults to an internal ClusterIP Service.
- Hindsight uses a dedicated PostgreSQL role/database/schema and a tokenless
  ServiceAccount. NetworkPolicy limits provider ingress/egress; no Control
  Plane or public provider route is exposed.
- Recall text is bounded, sanitized, and fenced as untrusted context. It cannot
  alter Runtime Policy, Access Policy, tools, or credentials. Provider failure
  is fail-open for Agent inference.
- Retain payloads are sanitized before persistence and encrypted with
  AES-256-GCM while queued. Project, Memory, and idempotency key are associated
  data. Provider append and Bank creation/deletion use stable idempotency keys.
- Logs and audits store safe status/identifier summaries rather than content,
  ciphertext, provider references, URLs, headers, or credentials. Relay metrics
  use only fixed low-cardinality labels.
- Export is Relay-generated, sanitized, Project/actor/Memory scoped,
  short-lived, rate-limited, and audited. It excludes credentials, provider
  references, and outbox envelopes.
- Bank deletion is reported only after the provider verifies absence. Project
  deletion performs the same verified cleanup and keeps a retryable tombstone
  on failure.

## Secret and content handling

The sanitizer removes common API keys, Bearer/Basic credentials, cookies,
database URLs, email/phone identifiers, and prompt-boundary markers before
runtime recall/retain or governance/export output. It is defense in depth, not
a substitute for minimizing sensitive input.

Hindsight's upstream OpenTelemetry integration can attach prompt and completion
content to spans. The chart keeps `HINDSIGHT_API_LLM_TRACE_ENABLED=false` and
4xx debug dumps disabled. Bank ID metric labels are also disabled because they
create a high-cardinality identifier channel. Any change to these defaults
requires a security review, redaction design, explicit retention period, and a
restricted telemetry destination.

The Relay and Control Worker metrics endpoints require an independent
`metrics-token`, use constant-time comparison, return no diagnostic body on
failure, and are intended only for in-cluster scraping.

## Audit coverage

Memory create/provision, bind, detach, rebind, rename, export authorization and
download, deletion start/success/failure, Conversation redaction/deletion and
re-extraction, Fact/Experience revision, item invalidation/restore, outbox
retry/dead-letter/replay, provider recovery, and Project deletion are recorded
through the platform audit route and/or Memory curation ledger. Records include
actor, time, object, action, outcome, and a bounded safe before/after summary.
Provider settings are deployment/operator configuration; changes are captured
by the deployment system rather than by a user-facing provider credential API.

## Security verification checklist

- Attempt Project, Memory, Bank, and runtime-token substitution across two
  Projects; every read/write must fail without revealing whether the target
  exists.
- Put fake API keys, Bearer tokens, cookies, database URLs, and prompt markers
  in a Conversation; assert absence from provider payloads, logs, traces, audit
  snapshots, exports, and UI responses.
- Confirm Admin/Developer, End user, and Auditor capabilities match the product
  matrix and hidden UI actions remain server-denied when called directly.
- Confirm arbitrary non-root UID, read-only root filesystem, tokenless provider
  ServiceAccount, and least-egress NetworkPolicy render for OpenShift.
- Interrupt retain, provisioning, and deletion; verify idempotent retry, no
  duplicate Conversation/Bank, and no false success.

