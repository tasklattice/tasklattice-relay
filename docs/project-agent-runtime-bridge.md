# Project Agent Runtime Bridge

## MVP decision

Hermes is the default Supervisor. OpenClaw remains the second selectable
Supervisor and Deep Agents Code remains last. A Project owns exactly one Agent
Runtime Bridge in its Runtime Namespace. The Bridge is runtime-neutral; Hermes
is its first adapter.

The Bridge publishes only eligible A2A 1.0 Instances from the Project Instance
Registry. Eligibility requires `READY`, `CALLABLE` or `HYBRID`,
`acceptsDelegation`, a validated Agent Card, and a reachable endpoint. Hermes
owns the plan and Kanban lifecycle. The Bridge does not generate a plan or
maintain Supervisor conversation memory.

## Runtime swimlane

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Hermes as Hermes Supervisor + Relay A2A plugin + Kanban
    participant Bridge as Project Runtime Bridge
    participant Control as Relay Control Plane
    participant Garden as Project Agent Garden
    participant Expert as External A2A Expert

    User->>Hermes: Submit a multi-step goal
    Hermes->>Hermes: Create Kanban plan and dependency cards
    Hermes->>Bridge: Discover peers with Coordinator-scoped bearer token
    Bridge->>Control: Project identity + forwarded Coordinator identity
    Control->>Garden: Query the Project Instance Registry
    Garden-->>Control: Eligible READY callable A2A Instances
    Control-->>Bridge: Filtered neutral capability descriptors
    Bridge-->>Hermes: a2a_agents map with Bridge proxy URLs
    Hermes->>Hermes: Create running specialist card
    Hermes->>Bridge: a2a_call(task_id) sends authenticated A2A SendMessage
    Bridge->>Control: Project + Coordinator authenticated proxy request
    Control->>Control: Re-check Instance eligibility and resolve credentials
    Control->>Expert: A2A 1.0 JSON-RPC SendMessage
    Expert-->>Control: Message or Task result
    Control-->>Bridge: Standard A2A response
    Bridge-->>Hermes: Standard A2A response
    Hermes->>Hermes: Plugin audits return/failure; Supervisor completes/blocks card
    Hermes-->>User: Synthesized result with visible scheduling state
```

## Component boundary

The Project Runtime Bridge owns:

- a stable Project-local discovery and delegation endpoint;
- Project-filtered Instance capability projection;
- per-Instance A2A proxy URLs and Agent Card URL rewriting;
- JSON-RPC `SendMessage` pass-through plus HTTP+JSON `/message:send`
  translation for A2A 1.0 provider interfaces;
- transport isolation between a Supervisor container and provider endpoints;
- a Project-scoped signed identity when calling Control;
- forwarding a separately signed Coordinator Instance identity for every
  discovery, Agent Card, and delegation request.

The Bridge is stateless: its Deployment uses only an ephemeral `/tmp` volume
and does not create or mount a PVC.

The Control Plane continues to own Agent Garden registration, the Instance
Registry, Agent credentials, capability filtering, Project ownership checks,
and audit integration. A2A `SendMessage` does not carry a mandatory skill
identifier, so the MVP advertises the validated Agent Card but does not claim
cryptographic per-skill enforcement inside a free-form delegated prompt.

The Bridge explicitly does not own LLM planning, task-graph generation, Hermes
Kanban state, global session memory, or cross-Project routing.

## Isolation and deployment

Project Runtime reconciliation server-side applies one Secret, Service,
Deployment, and NetworkPolicy into the opaque Project Namespace. The Bridge Pod
does not mount a Kubernetes service-account token, database credentials, Agent
credentials, or the global Runner token. It receives a Project Bridge HMAC token
whose signed payload fixes both `projectId` and Runtime Namespace. Each Hermes
Instance separately receives a Coordinator HMAC token fixing `projectId`,
Namespace, and `coordinatorInstanceId`; the Bridge can forward but cannot forge
that identity. Control verifies both signatures and the current Runtime Target
before serving a request. A deleted Coordinator also loses access because the
active Supervisor record and its `canDelegate` capability are resolved on every
call.

The Bridge has no PVC; discovery and capability requests are backed by Control.

## Health checks and Control connectivity

At startup, the `project-runtime-bridge.started` JSON log includes the effective
listening `host`/`port`, `projectId`, `controlUrl`, parsed `controlHost` and
`controlPort`, `bridgeUrl`, and `projectTokenConfigured`. The Control port is
derived from the configured URL, including the HTTP/HTTPS default when omitted.
`bridgeUrl` is `null` when `TALI_PROJECT_RUNTIME_BRIDGE_URL` is unset and URLs
are derived from each incoming request. URL credentials, query strings and
fragments are omitted from logs; the Project token itself is never logged.
View this event with `kubectl -n <project-namespace> logs deployment/tali-agent-runtime-bridge`.

`GET /readyz` is the readiness check. It requests
`TALI_CONTROL_INTERNAL_URL/api/health` without credentials and requires HTTP 2xx
with JSON `ok: true`. DNS/connection failures, a two-second timeout (including
body reads), redirects, unhealthy Control responses, and malformed responses
produce HTTP 503. The response includes a safe reason in `control.reason`:
`unreachable`, `timeout`, `http_error`, or `invalid_response`.

`GET /healthz` retains its legacy process-only liveness contract; `/livez` is
an alias. A Control outage makes the Bridge
Pod unready and removes it from ready Service endpoints without restarting it.
The readiness probe allows three seconds and fails after one failed check;
the next successful check restores readiness. Control's `/api/health` also
checks its database. Readiness does not validate Coordinator credentials or
certify every A2A operation.

Deploy the updated Control image **and Control Worker**, then run **Reinitialize
Project** for existing tenants. Worker reconciliation updates each tenant's
Bridge image and probe configuration; new tenants receive both automatically.
Use an immutable image tag/digest or a new rollout revision. Image-first upgrades
keep old `/healthz` liveness probes safe; upstream-aware readiness starts only
when the Worker updates the readiness probe to `/readyz`. Conversely, a new
probe against an old image fails readiness (404) without restarting the process.
Rolling back requires restoring the Worker/image configuration and reconciling
tenants too; tenant Deployments are managed by the Worker, not directly by Helm.

### Investigating cross-namespace timeouts on OCP

The generated Bridge NetworkPolicy permits DNS on UDP/TCP 53 and TCP to the
Pods selected by the exact Control Service in `TALI_CONTROL_INTERNAL_URL`.
Worker reads that Service on every reconciliation and copies its complete
selector, including the Helm release and application labels. It allows the
configured Service port and its `targetPort` (the chart uses the named Pod port
`http`, currently 8080). Namespace and Pod selectors share one peer, so both
must match. Missing Services, selectors, or matching TCP ports fail reconciliation
before any Bridge resource is changed.

Helm sets `server.internal_url_managed=true`; its rendered Control address is
authoritative even if the database retains an older bootstrap URL. Changing
`control.service.port`, the Service name, or release namespace updates the
effective URL after the Control/Worker rollout. Reinitialize Project or periodic
Worker reconciliation then updates both the Bridge Deployment and NetworkPolicy.
There is no fixed Control Pod IP. Manual installations that omit the managed flag
retain Platform Settings overrides.

With `openshift.enabled=true`, DNS egress also permits UDP/TCP **5353**.
Earlier versions allowed only 53, missing OCP's DNS backend port after Service
DNAT. That can prevent resolving the Control Service name and surface as an
upstream timeout/502. Expert Agent runtime policies use the same DNS rule so
their Bridge lookups work too. Ordinary Kubernetes keeps its existing port-53
rule. Red Hat documents the OCP DNS port in its
[DNS NetworkPolicy example](https://docs.openshift.com/ko/documentation/red_hat_openshift_distributed_tracing_platform/3.11/html/installing_distributed_tracing/distr-tracing-tempo-network-policies_distr-tracing-tempo-installing).
Reinitialize Project applies the corrected Bridge policy in place and, on OCP,
adds `tali-runtime-dns`. This additive, namespace-owned policy selects only
Relay-managed Bridge and Expert Agent Pods and allows DNS on 53/5353. It covers
already-running Expert Agents without changing their per-Agent policies or
restarting their Pods. Repeated initialization applies the same policy name.
It is not created on ordinary Kubernetes. As with other Worker-owned resources,
an image/Helm rollback does not remove it; retaining the DNS allowance avoids
reintroducing the OCP lookup failure. Namespace deletion removes it with the
other tenant resources.

The Hindsight API, Worker and migration Job had the same port-53-only omission.
Their Helm-managed policies now include UDP/TCP 5353 on OCP and explicitly
include host-network DNS peers using an empty Pod selector. Helm upgrade updates
all enabled policies in place; ordinary Kubernetes keeps the prior rules.
Disabling Hindsight or its NetworkPolicy option still suppresses these resources.

The other default tenant policy, `<gateway>-sandbox-ssh`, selects only Pods with
`openshell.ai/managed-by=openshell` and restricts ingress to SSH port 2222.
It does not select the Bridge or restrict egress. The two generated policies
therefore do not conflict. Expert Agent policies, when present, select their
own `tali.io/agent-key`, not the Bridge.

Control's Helm template does not create an ingress NetworkPolicy. If a platform
policy isolates Control, it must also allow ingress from the tenant Bridge.
Allowing Bridge egress alone cannot override a Control ingress restriction.
See the [Kubernetes NetworkPolicy semantics](https://kubernetes.io/docs/concepts/services-networking/network-policies/).
Inspect the installed policies and labels before changing them; an additional
ingress policy on previously unrestricted Control Pods would itself introduce
ingress isolation and could break UI, Runner, and other callers.

Run these read-only commands against the affected OCP context:

```bash
NS='replace-with-tenant-namespace'
CONTROL_NS='replace-with-control-namespace'
CONTROL_SERVICE='replace-with-control-service-name'
BRIDGE='tali-agent-runtime-bridge'

oc -n "$NS" get networkpolicy -o yaml
oc -n "$CONTROL_NS" get networkpolicy -o yaml
oc get namespace "$CONTROL_NS" --show-labels
oc -n "$CONTROL_NS" get pods \
  -l app.kubernetes.io/component=control --show-labels -o wide
oc -n "$CONTROL_NS" get service "$CONTROL_SERVICE" -o yaml
oc -n "$CONTROL_NS" get endpointslices \
  -l "kubernetes.io/service-name=$CONTROL_SERVICE" -o yaml
# OCP's DNS Service port 53 maps to backend port 5353.
oc -n openshift-dns get service dns-default -o yaml
oc -n "$NS" logs "deployment/$BRIDGE" --since=1h --timestamps --tail=200

# Runs inside the actual Bridge Pod, even when its readiness is failing.
# Prints only the configured destination, HTTP status, and network error code.
oc -n "$NS" exec "deployment/$BRIDGE" -- node -e '
const base = process.env.TALI_CONTROL_INTERNAL_URL.replace(/\/$/, "");
const url = new URL(base + "/api/health");
console.log("Control destination:", url.hostname, url.port || "80");
fetch(url, { signal: AbortSignal.timeout(5000), redirect: "manual" })
  .then(r => { console.log("Control HTTP", r.status); return r.body?.cancel(); })
  .catch(e => { console.error(e.name, e.cause?.code || ""); process.exitCode = 1; });
'
```

Interpret results together:

- `ENOTFOUND` / `EAI_AGAIN`: inspect Service DNS and the cluster DNS path.
- Empty/unready Service EndpointSlices: inspect Control readiness, selector,
  and `targetPort`; this is not evidence of a NetworkPolicy fault.
- Healthy endpoints but connection timeout: compare Bridge egress and Control
  ingress selectors/ports. If permitted by the operator, compare a direct
  Control Pod-IP:8080 request from the same Bridge Pod with the Service request.
  Pod-IP success and Service failure points toward Service routing/DNAT issues.
- HTTP 503 from Control: the network path worked; inspect Control/database health.

For an existing Control ingress isolation policy, add an allow peer combining
`namespaceSelector.matchLabels: {tali.io/runtime-target: "true"}` and
`podSelector.matchLabels: {app.kubernetes.io/name: tali-agent-runtime-bridge}`,
on TCP 8080, while preserving all existing ingress allowances. Verify the tenant
Namespace label exists first. Standard NetworkPolicies are additive, but OCP
cluster-level admin policies or other network controls may still restrict traffic.
If those APIs are installed and accessible, inspect AdminNetworkPolicy,
BaselineAdminNetworkPolicy, EgressFirewall, and any service-mesh authorization
rules as well. Do not delete all NetworkPolicies as a diagnostic shortcut.

After the fix, `/readyz` must return 200, the Bridge must be Ready, and a Hermes
startup must successfully fetch A2A configuration. A health check alone does not
validate the complete authenticated Sandbox → Bridge → Control path.

## Hermes adapter

At sandbox bootstrap, Relay:

1. adds an OpenShell network rule for the Project-local Bridge only;
2. fetches the current eligible Project A2A Instances;
3. validates every peer URL remains under the Bridge origin;
4. writes only the authenticated dynamic Registry endpoint into Hermes
   configuration;
5. enables Relay's bundled `tali-a2a` outbound plugin plus the `a2a` and
   `kanban` toolsets;
6. instructs the Supervisor to create a `blocked` Kanban card assigned to the
   reserved `tali-a2a` assignee and pass its `task_id` to every A2A call.

The sandbox is pinned to Hermes v0.19.0, which includes Kanban but does not
ship the newer upstream A2A plugin. Relay therefore overlays a deliberately
small outbound-only compatibility plugin. It registers `a2a_list`,
`a2a_discover`, and `a2a_call` through Hermes' stable plugin API, supports A2A
1.0 JSON-RPC `SendMessage`, and refuses arbitrary call URLs or Agent Card
cross-origin redirects. `a2a_call` requires an existing Kanban `task_id`,
promotes and claims the reserved card as `running` through Hermes' own Kanban
APIs, and writes neutral start/return/failure audit comments itself. Starting
blocked prevents Hermes' local worker dispatcher from racing the external A2A
dispatch. The Supervisor still owns task creation, dependencies, evidence
synthesis, and final complete/block state. The image build runs the plugin against the pinned Hermes plugin
manager, performs a real loopback A2A call, and verifies the two Kanban audit
events.

The Relay A2A plugin refreshes the Project Registry whenever `a2a_list`,
`a2a_discover`, or `a2a_call` resolves a peer. Creating, removing, or changing
the readiness of an A2A Instance therefore does not require a Hermes restart.
The MVP surfaces an immediate
A2A Message or Task state from `SendMessage`; it does not yet poll a remote
long-running Task, consume streaming responses, or register push
notifications. Hermes should leave or block the corresponding Kanban card when
the returned Task is still non-terminal.

## OpenClaw compatibility

No core Control route contains Hermes concepts. The only Hermes-specific route
is the thin `/v1/hermes/a2a-agents` presentation endpoint in the Bridge.
OpenClaw can reuse the neutral `/v1/agents` directory and identical Project-local
per-Agent A2A URLs through its own plugin/config adapter. Credentials, approval
decisions, Project isolation, and provider calls remain unchanged.
