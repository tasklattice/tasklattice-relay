# Control Plane configuration

See [Platform configuration ownership](platform-configuration-ownership.md)
for the reviewed boundary between deployment bootstrap, online Platform policy,
and external secrets.

TaskLattice Relay Control reads one deployment TOML file. Production starts
only when `TALI_CONFIG` points to a valid file. The Helm chart renders this file
as the `control.toml` entry in the TaskLattice Relay Secret and mounts it
read-only at `/etc/tali/control.toml`. It contains bootstrap credentials, infrastructure seed values, and typed
sections for memory and metrics. Worker also mounts a separate `worker.toml`
selected by `TALI_WORKER_CONFIG`, containing provisioners and Docling settings.
Control rejects Worker sections and never mounts that Secret; neither reads the former business
environment variables. Kubernetes discovery and process bootstrap variables
(`TALI_CONFIG`, `PORT`, `NODE_EXTRA_CA_CERTS`, `POD_NAMESPACE`) remain environment-owned.

```toml
schema_version = 1

[server]
# Allowed browser origins, with no canonical redirect target.
public_urls = ["https://tali.example.com", "https://relay.example.com"]
# Enable only behind an ingress that overwrites forwarded host/protocol headers.
trust_proxy_headers = false
# Service-to-service address; never used for browser redirects.
internal_url = "http://tali-relay-control.tali.svc.cluster.local:38080"

[database]
url = "postgresql://tali:password@postgresql:5432/tali"

[auth]
secret = "replace-with-at-least-32-random-characters"

[auth.local]
initial_platform_administrator_username = "admin"
initial_platform_administrator_email = "admin@tasklattice.local"
initial_platform_administrator_password = "replace-with-a-strong-password"
```

`server.public_urls` is a nonempty allowlist of exact HTTP(S) origins, including
any non-default ports. Entries cannot contain paths, credentials, queries or
fragments. Ordering has no meaning. Login, logout and OAuth callbacks use the
validated origin of the incoming request; the UI never redirects to a configured
canonical domain. Cookies remain scoped to each host, with Secure cookies on HTTPS.

By default, forwarded headers are ignored. Set `server.trust_proxy_headers=true`
only when the trusted ingress overwrites `X-Forwarded-Host` and `X-Forwarded-Proto`.
The resolved origin must still appear in `public_urls`; unknown hosts or protocols
are rejected. Internal service addresses are not browser origins and must not be
added to the allowlist just to satisfy internal connectivity.

The OpenShift Helm profile enables proxy trust for its managed edge Route and
sets `haproxy.router.openshift.io/set-forwarded-headers: replace`. OpenShift's
[router template](https://github.com/openshift/router/blob/release-4.16/images/router/haproxy/conf/haproxy-config.template)
uses `set-header` for both forwarded Host and Proto in this mode; `append` can
produce comma-separated values. The router derives these values from the Host
and TLS connection it receives. If TLS terminates before the router and that
hop is HTTP, the replacement protocol is still `http`: fix the final proxy's
public-origin handling rather than relaxing the Control allowlist.

The browser decision is one question: is the request's `Origin` one of the
configured `public_urls`? The browser sets `Origin` itself and a cross-site page
cannot forge it, so allowlist membership is the CSRF guarantee. Header resolution
(`Host`/`X-Forwarded-Host`, a single `X-Forwarded-Proto` value; `Forwarded` and
`X-Forwarded-Port` are never consumed) is used for diagnostics and for the
deployment contract, not to veto an allowlisted write:

| Condition | Result |
| --- | --- |
| `Origin` is an allowlisted public URL | allowed |
| … and the proxy headers disagree or cannot be resolved | allowed; `control_origin_proxy_mismatch` warning with `reason` (`host_missing`, `host_not_allowed`, `origin_unverifiable`, `resolved_origin_differs`) |
| `Origin` is not an allowlisted public URL | `403 CONTROL_ORIGIN_FORBIDDEN` (`origin_not_allowed`) |
| `Origin: null` on a Control surface | `403 CONTROL_ORIGIN_ISOLATED_ORIGIN_FORBIDDEN` |
| Safe methods, or a request with no `Origin` | not checked here; the session is validated downstream |

`503 CONTROL_ORIGIN_CONFIGURATION_ERROR` is reserved for tasks that must build an
absolute URL (SSO callbacks, invitation links, Better Auth base URL) when the
request cannot be resolved **and** more than one public URL is configured. With a
single configured public URL there is nothing to choose between, so Control uses
it instead of failing. A proxy header mistake therefore degrades to a warning on
browser writes, never to an outage of the write path.

The guard applies to browser-session writes only. `/_agent-ui/*` Agent documents
(their capability credential is validated by the dedicated proxy), `/api/metrics`,
`/api/v1/runtime-bridge/*` and `/api/health` authenticate without Control cookies
and are therefore outside the cookie CSRF rule even when a stale cookie is sent.
Safe methods on every other path are never blocked by this guard.

`GET /api/health` reports the static contract and how the probe request itself
resolved, so a single command answers "does my ingress agree with the config?":

```json
{"ok":true,"database":"postgresql","runtime":"openshell","origin":{
  "allowedOrigins":["https://relay.example.com"],"trustProxyHeaders":true,
  "state":"ok","thisRequest":{"host":"relay.example.com","origin":"https://relay.example.com","resolved":true}}}
```

`state: "suspicious"` marks an HTTPS-only allowlist that ignores forwarded
headers; that combination never resolves the plaintext request Control receives
from its Service, so every browser write logs `control_origin_proxy_mismatch`. It
is also logged once at startup as `control.origin_contract_suspicious`, with the
same `hint`, and it does not block writes. A probe arriving on the Pod address is
expected to resolve outside the allowlist; run the probe through the ingress to
see what a browser gets.

```bash
# Effective configuration (only [server] reloads in place; see below)
kubectl -n tali get secret tali-relay-control-config \
  -o jsonpath='{.data.control\.toml}' | base64 -d | sed -n '/\[server\]/,/^\[database\]/p'
# Contract verdict, then the same probe through the public endpoint
kubectl -n tali exec deploy/tali-relay-control -- curl -s localhost:8080/api/health
curl -s https://relay.example.com/api/health
# Guard outcomes, newest last: rejections explain 403, mismatches explain warnings
kubectl -n tali logs deploy/tali-relay-control --since=30m \
  | grep -E 'control_origin_(rejected|proxy_mismatch)' | tail -3
```

The `[server]` section reloads in place. Control polls its mounted configuration
file and adopts a changed `[server]` section without a restart, logging
`control.configuration_reloaded` with the new revision; `GET /api/health` reports
that revision as `config.revision` next to the effective `origin` block. A
corrected `public_urls`, `trust_proxy_headers` or `internal_url` therefore takes
effect on the next request after the Secret edit, with no rollout and no
`rollout restart` — the Pod is not the source of truth for those values.

Every other section (`database`, `auth`, `runner`, `litellm`, `memory`, `metrics`,
`runtime_namespaces`, `demo_agents`) needs a new Pod. A file that changes both
`[server]` and any of those is left entirely unapplied and logged as
`control.configuration_reload_deferred` with the sections that require a restart,
so a new database URL or auth secret is never half-applied. An unparsable or
invalid file is ignored and logged as `control.configuration_reload_invalid`; the
previous configuration keeps serving. Roll those out explicitly:

```bash
kubectl -n tali rollout restart deployment/tali-relay-control
kubectl -n tali rollout status deployment/tali-relay-control --timeout=5m
```

The Chart also changes `checksum/control-config`, so a `helm upgrade` rolls the
Deployment by itself; verify that rollout actually completed. In Argo CD, a failed
PostgreSQL sync at wave `20` can prevent the Control rollout at wave `40`.
Confirm `control.started` reports the expected `allowedOrigins` and
`trustProxyHeaders` on every new replica before reproducing a failure.

Origin rejections emit a server-side `control_origin_rejected` JSON log, and an
allowlisted origin whose proxy headers disagree emits
`control_origin_proxy_mismatch`. Both carry the `reason`, the effective
`trustProxyHeaders`, `allowedOrigins`, browser/request/resolved origins, and
bounded host/protocol headers. These logs omit cookies, authorization headers,
URL query strings and request bodies. API responses carry the `x-request-id`
(also returned as the problem `instance`) so a report can be matched to its log
line; they never expose internal hosts or header values.

Origin guard rejections use `application/problem+json` with `status`, `code`,
`instance` and a safe `detail`, retaining the `CONTROL_ORIGIN_CONFIGURATION_ERROR`
and `CONTROL_ORIGIN_FORBIDDEN` codes. Access selection separately returns
`access_context_not_assigned` when the submitted context is no longer in the
current options, and a Project role switch returns `project_role_not_assigned`
for the same condition. Both are explicit `403` decisions: no domain throw relies
on message text to pick a status any more. The access page distinguishes these
errors by code and offers an explicit refresh for unavailable options; other
`access_denied` responses are not treated as expired options. Refreshing does not
resubmit a selection.

Better Auth's warning about `advanced.ipAddress.ipAddressHeaders` or
`advanced.ipAddress.trustedProxies` is a separate client-IP resolution issue.
Without a resolved IP, its rate limiter uses a shared per-path bucket and returns
`429` when exhausted; it does not produce the Control origin guard's `403`.
`trust_proxy_headers` only controls host/protocol resolution and does not
configure those Better Auth IP options. Do not disable origin validation or
rate limiting to suppress the warning.

Register `<origin>/api/auth/callback/corporate-sso` and `<origin>/login` with the
OIDC provider for each allowed origin. Platform Settings lists all callback URLs;
the embedded Keycloak realm is generated from the same list. Scopes are fixed to
`openid profile email groups`.

OIDC is configured only from **Platform Setting -> Security & SSO** and is
stored in the Platform database. There is no `control.toml` fallback. Complete
the form, select **Validate SSO**, then save the validated configuration.
Control replicas refresh Better Auth from the shared settings revision without
a restart.

**Validate SSO** checks the unsaved issuer against its discovery document and
confirms that the advertised JWKS endpoint contains signing keys. Validation
does not persist the draft or send the Client secret to the identity provider;
the Client ID and Client secret are verified only during an actual SSO sign-in.

The online Client secret is encrypted at rest with a key derived from
`auth.secret` and is never returned by the API. Keep `auth.secret` stable across
all Control replicas. Before rotating it, plan to sign in locally and replace
the stored OIDC Client secret and SMTP password after rotation.
Local authentication enablement is also database-owned. Security validation
requires at least one authentication method to remain enabled and confirms the
bootstrap Local credential exists before a draft can enable Local sign-in.

SMTP is configured only from **Platform Setting -> Email delivery** and is
stored in the Platform database. There is no `control.toml` fallback.
Invitations to an email address that does not already map to a Relay user are
rejected until email delivery is enabled. Invitation links use the validated origin of the
request that sends the invitation. Set implicit TLS for port 465; for port
587 leave it off so the transport can upgrade with STARTTLS. Username and
password must either both be configured or both be empty for an unauthenticated
internal relay.

New OpenShell Sandbox CPU and memory defaults and the Project Namespace
deletion timeout are database-owned and can be changed from **Platform Setting
-> Sandbox**. Hermes, OpenClaw, and Deep Agents image references remain editable under
**Platform Setting -> Runtime** because they are resolved when a new Sandbox is
created.

Control internal URL, Runner URL and token, LiteLLM URL and master key, and
Runtime Namespace enablement and cluster identity are configured
from **Platform Setting -> Infrastructure**. Editing creates a browser-local
draft. **Validate configuration** probes Control, Runner, and LiteLLM, checks
the Worker's recent report of its Kubernetes permissions when Runtime Namespaces are enabled, and rejects a
cluster identity that conflicts with existing Runtime Targets. A deployment
using Project OpenShell target routing also rejects disabling Runtime
Namespaces because Agent operations would no longer have a routable target. A short-lived
validation token is bound to the exact draft, so any later edit requires a new
validation before **Save verified configuration** becomes effective.
When Project Runtime Bridges are enabled, the Control internal URL must be the
full in-cluster HTTP Service name
(`http://<service>.<namespace>.svc.cluster.local:<port>`). Bridge egress is
restricted to Control Pods in that Namespace rather than to an arbitrary host
sharing the same port.

Helm sets `server.internal_url_managed=true`: `server.internal_url` follows the
deployed Control Service and takes precedence over an old database value. The
Infrastructure view displays it read-only. Change its Helm Values and roll out
Control/Worker, then reinitialize existing Projects to apply the new Bridge URL
and policy immediately. Manual installations without this flag retain the saved
Platform Control URL override.

`[runner]`, `[litellm]` and `[runtime_namespaces]` seed missing Platform runtime
fields. Once saved, their database values remain canonical; restarting does not
overwrite an administrator's settings. OpenShell gateway topology remains
deployment-owned and read-only in Platform Setting.

Control and Worker share the core configuration. Sections under `[worker]`
exist only in `worker.toml` and are read only by Worker:

| Section | Responsibility |
| --- | --- |
| `worker.toml`: `[worker]`, `[worker.docling]` | Health port, queue identity, parser URL/API key and enablement |
| `[memory]` | Provider URL/credentials, master switch, project allowlist, recall timeout, dimensions |
| `[metrics]` | Metrics bearer token |
| `[worker.project_openshell]` | Tenant chart, images, separate Gateway/Supervisor pull policies, storage |
| `[worker.project_runtime_bridge]`, `[worker.expert_agent_runtime]` | Images, resources, pull secrets, readiness timeout |
| `[worker.resource_ownership]` | Namespace ownership and Argo CD tracking annotations |
| `[worker.provisioning]` | Instance provisioning timeout |

Demo Agent image defaults belong to the demo module, not the core configuration.
`images.exampleMcp` configures only the optional example MCP Deployment.

Nested resources and pull secrets are TOML objects/arrays, not JSON strings in
environment variables. Unknown section keys and invalid typed values fail
startup. The old `TALI_BOOTSTRAP_*`, `PROJECT_*`, `TALI_HINDSIGHT_*`,
`DOCLING_BASE_URL`, and Worker business environment overrides are removed.
The mounted file contains secrets and must not be published in diagnostics.
See [component configuration and persistence](helm-component-configuration.md)
for the complete Helm mapping and CA validation commands.

## Identity ownership

Better Auth is the sole authentication and session owner. PostgreSQL stores
its `users`, `auth_accounts`, `auth_sessions`, and `auth_verifications` models
in the `tasklattice` schema. The same `users.id` is the stable subject consumed
by TaskLattice Relay authorization.

Dashboard sessions use a 30-minute sliding idle timeout. Every authenticated
API request refreshes the Better Auth database expiration and browser cookie.
After 30 minutes without activity the session is invalid and is deleted when it
is next presented to Better Auth.

Relay namespaces all Better Auth cookies with the `tali-relay` prefix. This is
required when Relay and another Better Auth application run on different ports
of the same hostname because browser cookies are not isolated by port.

All three initial Platform Administrator values are required bootstrap values.
On first startup, Better Auth creates one `credential` account and hashes the
plaintext bootstrap password with its native password hasher. Later startups
never overwrite an existing database identity or password. Password changes
run through Better Auth and revoke the user's other sessions. Whether Local
sign-in is active after bootstrap is controlled by Platform Setting.

OIDC login is implemented by Better Auth's Generic OAuth plugin with discovery,
PKCE, and required ID-token verification. External identities are stored as
Better Auth accounts keyed by the provider issuer and stable subject. The
provider may create a Better Auth user on first successful login.

Application requests resolve a Better Auth cookie session into a minimal
`PlatformPrincipal`; no JWT claims or browser-stored bearer token cross this
boundary. TaskLattice Relay sessions use the local `users.id` as their subject.
Department administration is loaded exclusively from an active
`department_members` binding whose role is `administrator`. Project business
authorization is loaded exclusively from `project_members`. These bindings do
not inherit from one another.

`systemRole=platform_administrator` remains platform-level metadata. It grants
neither Department nor Project access. Department administration still comes
only from an active Department `administrator` membership, and Project
Capabilities still come only from the active Project Role.

The configuration file still contains credentials and must be treated as a secret.
Do not commit a deployed `control.toml`; `control.example.toml` is the tracked
template.

For complete SSO integration tests, the Helm Chart can deploy a preconfigured
ephemeral Keycloak instance. It is a development-only component: enable it with
`developmentProfile.enabled=true` and `keycloak.enabled=true` (the
`values-dev.yaml` profile does the first), then enter its issuer and generated
Client credentials in **Platform Setting -> Security & SSO**. Released and
OpenShift profiles reject `keycloak.enabled=true`; they use an external OIDC
provider instead. See the Chart README for test users and deployment examples.

SSO authorization is also database-owned. Configure the OIDC Group claim
(normally `groups`) and explicit Group Role Bindings in Platform Setting. A
binding targets the Platform, one Department ID, or one Project ID and one
stable Role ID. The Control plane matches complete Group paths exactly during
SSO sign-in; it never grants authority merely because a Group name resembles a
Role. Removing a Group revokes only its external grant and preserves manually
assigned memberships.

Project provisioning is asynchronous; see [Project resource lifecycle](project-resource-lifecycle.md).

## Operational server logs

Control and Worker use the direct `consola` dependency for operational logging.
The Relay adapter retains only severity mapping, the JSON reporter and redaction;
request IDs remain in request diagnostics. Consola supplies dispatch, timestamps,
component tags and level filtering. No global console wrapping is installed.
Repeated-event throttling is disabled so request/job records are not merged.

Control emits JSON records to stdout/stderr with `timestamp`, `level`,
`component` and `event`. Helm enables successful access logs through
`control.accessLog.enabled` (`TALI_ACCESS_LOG_ENABLED`). Disabling it suppresses
successful request records; 4xx/5xx, runtime errors and startup diagnostics remain.

For an HTTP failure, copy the response's `X-Request-Id` and search all Control
replicas for that `requestId`. The server generates this ID; it does not trust
an inbound correlation header. Immutable upstream/upgrade responses may not
carry this response header. Access records still contain the ID.

| Event | What it establishes |
| --- | --- |
| `control.started` | Loaded `allowedOrigins`, `trustProxyHeaders`, access log mode and process ID; not a database/readiness check |
| `http.access` | Request ID, fixed route category, method, status, transport and duration |
| `control_origin_rejected` | Same request ID plus browser/resolved origins and effective proxy settings |
| `http.handler_failed` | Handled 5xx error, sanitized stack/cause/code and `errorId` |
| `runtime.error` | Framework-captured exception; request ID when the framework supplies a request |
| `auth.diagnostic` | Better Auth warnings/errors, including the separate client-IP/rate-limit warning |
| `audit.write_failed`, `audit.retention_failed` | Audit persistence and retention failures |
| `cost.ingestion_failed`, `cost.ingestion_partial_failure` | Cost sync failure or affected projects |
| `catalog.seed_failed` | Catalog initialization failure |

Handled 5xx responses also carry `X-Control-Error-Id`. Find its value as `errorId`
in `http.access` and `http.handler_failed` to join the response to the exception.
Auth library diagnostics have no request ID because the library logger does not
receive request context. They must be correlated by time and replica.

Access logs use fixed categories such as `auth-sign-in`, `access-context`,
`platform-api`, `project-api` and `department-api`. They never record raw paths,
queries, request bodies, cookies or authorization headers. Error text is bounded
and redacted for known credential formats, URL userinfo/query/fragment values,
and sensitive structured fields. Do not add full configuration objects or
request/response bodies to log calls. Redaction cannot identify every arbitrary
secret embedded in free text.

These logs provide HTTP failure triage, not distributed tracing. Per-upstream
DNS/TLS/connect/response timings and a trace across Control, Worker, Relay
Runtime and LiteLLM are not currently available. Project provisioning uses
Worker task/resource records; authorization decisions and resource IDs belong
in the business audit records. Independent Runtime Bridge, Hindsight Router and
demo processes still have legacy console logs outside this Control migration.


### Severity policy

The structured `level` field has exactly four values: `critical`, `error`,
`warning` and `info`, mapped to consola's `fatal`, `error`, `warn` and `info`. Alerting and log queries
must use `warning` rather than the previous `warn` value. Library `debug` output
is omitted; Better Auth `warn` is mapped to `warning`. Critical and Error go to
stderr, Warning uses `console.warn`, and Info goes to stdout. Classify by the
JSON `level`, since stderr contains more than one severity.

| Level | Meaning | Branches |
| --- | --- | --- |
| `critical` | Startup cannot complete, or a process-level exception requires immediate investigation | Invalid Control configuration, Nitro plugin failure, uncaught exception/unhandled rejection, fatal Worker run failure |
| `error` | A request or operation failed; not evidence that the whole service is down | HTTP 5xx, handler exceptions, exhausted job retries, terminal connect failure/timeout, OpenShell install failure, audit write failure, cached SSO credential cleanup failure |
| `warning` | Request rejected, degraded service or recovery/retry pending | HTTP 4xx, origin rejection, job retry, provider cleanup deferred, SSO fallback, Worker report retry, abnormal terminal closure, diagnostics collection unavailable |
| `info` | Normal lifecycle/progress or recovery | Startup/shutdown, successful access, job start/completion, terminal connection, resource status changes, diagnostics recovered |

A retry event includes `retryCount` and `retryLimit`; exhausted attempts emit
`job.failed` at Error rather than `job.retry`. The diagnostics collector emits
one Warning per outage and an Info on recovery, not one Warning each poll.
Critical logging does not itself change restart/exit behavior. Access records
and detailed failure records are separate events linked by request/error IDs;
count access records when calculating failed request totals.
