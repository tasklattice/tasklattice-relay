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
  select another Bank. Native Hindsight receives an Instance alias; Control
  resolves its current binding and rejects every other alias.
- Hindsight's root credential is read only by Control/Worker from a Secret and
  is never sent to a browser or Agent. The provider URL is operator-managed
  configuration, not user input, and defaults to an internal ClusterIP Service.
- Hindsight uses a dedicated PostgreSQL role/database/schema and a tokenless
  ServiceAccount. NetworkPolicy limits provider ingress/egress; no Control
  Plane or public provider route is exposed.
- OpenClaw recall text is bounded, sanitized, and fenced as untrusted context. It cannot
  alter Runtime Policy, Access Policy, tools, or credentials. Provider failure
  is fail-open for Agent inference.
- Retain payloads are sanitized before persistence and encrypted with
  AES-256-GCM while queued by Relay (OpenClaw). Hermes uses native Hindsight
  retain and its async operation queue; no Relay outbox copy is created.
  Project, Memory, and idempotency key are associated
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

Native Hindsight transport supports version, retain, recall, reflect, operation
status, document listing and the coding plugin's knowledge-page operations.
Only bounded document/search query parameters and upstream tag-match modes are
accepted. Bank administration, arbitrary URLs, redirects and cross-Instance
aliases are denied. The config probe returns only `store_document_text`; model
configuration and credentials never leave Control. Each call checks the current
Project feature gate, embedding availability and active binding; detach/rebind
revokes the old credential immediately. Requests and responses have byte limits,
request text is sanitized, and upstream errors are replaced with opaque errors.
The service root key stays in Control. Native recall formatting and background
retry behavior belong to the upstream Hermes provider.

Dcode and Pi use the official `hindsight-coding-agents` 0.8.2 bundle installed
in their image. Runtime installation uses local files, disables package updates
and accepts only an endpoint-bound OpenShell credential reference. Native mode
does not load the plugin. Dcode permits one image-owned Hindsight stdio command
through its native MCP loader; arbitrary MCP configuration remains disabled.
Its child receives only the required OpenShell proxy/CA settings, with no model
keys or arbitrary `NODE_OPTIONS`.

The Hindsight 1.1 launcher binds knowledge-page calls using upstream's task-local
Bank context, including reset after errors. The project router still rejects
inference without a Bank; it never assigns a default tenant to missing context.

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

