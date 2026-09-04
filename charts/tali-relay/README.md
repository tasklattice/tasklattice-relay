# TaskLattice Relay Helm Chart

This chart installs the complete TaskLattice Relay stack: control/UI, Control
Worker, Docling Serve, OpenShell runner, LiteLLM, PostgreSQL with pgvector,
the internal Hindsight Durable Memory provider, OpenShell, and the Agent
Sandbox controller.
Its Chart, package, and default Helm release name is `tali-relay`; the examples
use the product-level `tali` Kubernetes namespace.
The Release Workflow selects OpenShell 0.0.106, NemoClaw v0.0.114, and Agent
Sandbox v0.5.1 by explicit upstream tags and does not follow `latest`. Builds
use the content currently published under those tags. Their upstream source is
not copied into this repository, while the released TaskLattice Relay archive
remains self-contained.

Prepare the dependency archives before rendering the source Chart:

```bash
npm run helm:dependencies
```

Release builds also package the complete Chart at
`/opt/tali/helm/tali-relay.tgz` inside the Control Plane image. The
image exposes that location through `TALI_HELM_CHART`.

The source Chart uses the development version `0.0.0-dev` and resolves its
first-party images to `:dev`. The Release workflow replaces both Chart version
and `appVersion` with the exact Git Release version before publishing.

The canonical application namespace is `tali` (displayed as **TALI**). The
separately released `tasklattice-guard` project must use the same namespace
when integrated with Relay. It is not a dependency of this Chart and no Guard
workload is packaged by this repository.

`control.publicUrl` is independent of `control.service.type`, but it is always
required as Better Auth's canonical browser origin. Set it to the exact origin
users open, including scheme and non-default port; it is also used for OIDC
callbacks and invitation links.

Install a released chart:

```bash
VERSION="<release-version>"
curl -fLO "https://github.com/tasklattice/tasklattice-relay/releases/download/v${VERSION}/tali-relay-${VERSION}.tgz"
helm upgrade --install tali-relay "./tali-relay-${VERSION}.tgz" \
  --namespace tali \
  --create-namespace \
  --wait \
  --timeout 30m
```

The same chart is published as an OCI artifact:

```bash
VERSION="<release-version>"
helm upgrade --install tali-relay \
  oci://ghcr.io/tasklattice/charts/tali-relay \
  --version "${VERSION}" \
  --namespace tali \
  --create-namespace \
  --wait \
  --timeout 30m
```

Defaults preserve the repository's trusted local-cluster setup and use
`admin/password`. Before shared or internet-facing use, provide a private values
file that changes every `secrets.*` value and configures OpenShell TLS/OIDC.
If the Agent Sandbox controller already exists cluster-wide, set
`agentSandbox.enabled=false`. For private GHCR packages, create a registry
pull Secret and add its `{name: ...}` reference to `global.imagePullSecrets`,
`agentSandbox.imagePullSecrets`, `openshell.imagePullSecrets`, and
`openshell.server.sandboxImagePullSecrets`. The Agent Sandbox controller runs
in the Helm release namespace and can reuse the same registry pull Secret.

Every first-party workload and configurable runtime dependency has explicit
CPU and memory requests and limits. The Chart also creates a namespace-scoped
Container `LimitRange` by default so OpenShell's dynamically injected sandbox
init containers receive CPU and memory defaults during admission. If the
OpenShift project or Kubernetes namespace already has an equivalent
administrator-managed `LimitRange`, set `resourceDefaults.enabled=false` to
avoid defining a second default policy.

`runner.sandbox.cpu` and `runner.sandbox.memory` are the deployment defaults
reported to Platform Setting. A Platform Administrator can override them for
new Sandboxes from **Platform Setting -> Sandbox** without restarting Control
or Runner. Clearing the override returns to these values. Gateway endpoint,
Workspace, service route base, service CIDRs, OpenShell Gateway/Supervisor/base
images, pull policy, and TLS mode are also reported to the page, but remain
read-only deployment topology.

`projectRuntimeNamespaces` seeds the initial Platform Infrastructure setting
when the database has no runtime configuration. After bootstrap, change
Namespace enablement and cluster identity under **Platform Setting ->
Infrastructure**; validation checks Kubernetes access and existing Runtime
Targets before save. The Chart always installs the reviewed runtime RBAC so the
feature can be enabled online. When enabled, Project creation synchronously
ensures an opaque, stable `tp-<16-character-base32>` Namespace before the API
returns success. The exact Project name is stored as an annotation and a
DNS-safe form is stored as a label.

When `projectOpenShell.enabled=true`, the same reconciliation installs the
repository-pinned official OpenShell chart as a separate Helm release in that
Project Namespace. It sets the Gateway's fixed sandbox Namespace to the
Project Namespace, uses a private `ClusterIP` Service and NetworkPolicy, and
reuses `openshell.resources`, image pull Secrets, images, and workspace storage
settings. Relay does not create a tenant ServiceAccount, quota, or LimitRange.

The main Control Plane ServiceAccount can ensure Namespaces and reconcile the
official per-Project OpenShell releases. The separate Control Worker uses a
PostgreSQL-backed durable queue for delayed Project deletion and periodic
Namespace plus Gateway repair. Runtime workloads receive neither identity.
Operators can also repair all mappings with the packaged one-shot command:

```bash
kubectl -n <control-namespace> exec deployment/<release>-control -- \
  node apps/control/.output/tools/project-runtime-reconcile.mjs
```

OpenShell 0.0.106 fixes one Kubernetes sandbox Namespace per Gateway. The
compatibility topology therefore runs one Gateway per Project but keeps one
central Runner. Every Agent lifecycle, audit, terminal, and Web UI operation
carries the stable Project Runtime Target; the Runner derives the trusted
Gateway Service address from `runner.projectTargetRouting.gatewayEndpointTemplate`.
It never accepts a Gateway URL from an API request. Browser service hostnames
are forwarded by the central Runner's workspace-aware service proxy.

The routing contract does not require Gateways to be shared. A validated
OpenShell 0.0.111-or-newer deployment can continue using the same dedicated
Gateway-per-Project topology for higher-SLA tenants, or disable the
per-Project provisioner and point the endpoint template at a shared Gateway for
standard-SLA tenants. Both choices preserve Project Namespace/workspace
identity and the centralized Runner; only the Gateway provisioner and endpoint
resolution policy differ.

`projectOpenShell.enabled`, the legacy shared `openshell.enabled` topology, and
`runner.projectTargetRouting.enabled` are validated together at Helm render
time. Runtime Namespace disablement is also rejected by Platform Setting while
Project target routing is deployment-enabled. See
[Project Runtime Namespaces](../../docs/project-runtime-namespaces.md).

The Control-to-Runner contract intentionally contains only the Project
Namespace. After a newer OpenShell/NemoClaw compatibility set is validated,
the per-Project Helm provisioner can be replaced by a shared Gateway/operator
adapter and the endpoint template can point to that shared service. Project
and Agent APIs, runtime-target rows, Sandbox identity, and central Runner
deployment do not need a topology rewrite.

Workload rollout checksums are component-scoped. Updating Control-only
settings such as `control.publicUrl` restarts the Control Deployment but does
not roll Runner, LiteLLM, or PostgreSQL. Changing a Service type by itself does
not restart application Pods.

## Argo CD sync order

The parent chart owns the Argo CD sync-wave policy. It does not patch or add
Argo CD annotations to the OpenShell and Agent Sandbox dependency charts, so
their regular resources keep Argo CD's default sync wave `0`. OpenShell's
certificate-generation resources also retain their upstream Helm
`pre-install,pre-upgrade` hooks and hook weights; Argo CD maps those hooks to
its `PreSync` phase.

TaskLattice Relay resources are deliberately later than the dependencies:

| Wave | Resources |
| ---: | --- |
| `-10` | Namespace `LimitRange` and optional OpenShift SCC RoleBindings required by dependency admission |
| `0` | OpenShell and Agent Sandbox dependency resources (unmodified default) |
| `10` | TaskLattice Relay ServiceAccounts, RBAC, Secrets, ConfigMaps, and Services, including the internal Hindsight Service |
| `20` | PostgreSQL StatefulSet and the version-scoped Hindsight migration Job |
| `30` | LiteLLM and optional Keycloak Deployments |
| `40` | Control, Control Worker, Runner, Hindsight API, and optional example MCP Deployments |
| `50` | Optional OpenShift Routes |

Argo CD waits for each wave to become healthy before advancing. The values are
centralized under `global.argocd.syncWaves` and can be adjusted for a cluster's
policy without editing any dependency chart. Plain Helm and Kubernetes ignore
the Argo CD annotations.

LiteLLM defaults to one Uvicorn worker per Pod. Uvicorn workers are separate
Python processes: each initializes a LiteLLM Router and Prisma query engine, and
the multiprocess supervisor reports an exited or unresponsive worker only as
`Child process died`. Scale with `litellm.replicaCount` when the deployment
needs more concurrency. If `litellm.workers` is raised instead, size memory for
every worker and inspect the container cgroup's `memory.events` when a child
disappears without a Pod restart.

The chart also defaults `litellm.localModelCostMap=true`. The released image
contains the price and context-window map shipped by its pinned LiteLLM version,
so startup does not contact GitHub and air-gapped cost attribution remains
deterministic. Connected operators may set it to `false` to opt into LiteLLM's
runtime remote map, accepting that pricing can then change independently of the
TaskLattice Relay image. Custom or private model pricing should still be set on
the model deployment itself.

`litellm.maximumTracebackLinesToLog=0` keeps request-level errors concise. Full
exceptions remain available in the LiteLLM container logs. Increase this value
only when request-level tracebacks are required for gateway diagnostics.

To trust HTTPS endpoints signed by a private CA, provide a PEM-encoded CA bundle
through `litellm.caCertificate`. The Chart creates a release-scoped Secret,
mounts it at `/etc/ssl/certs` only in the LiteLLM Pod, and triggers a LiteLLM
rollout when the certificate changes. For example:

```yaml
litellm:
  caCertificate: |
    -----BEGIN CERTIFICATE-----
    ...
    -----END CERTIFICATE-----
```

The certificate can also be supplied without copying it into a values file:

```sh
helm upgrade --install tali-relay charts/tali-relay \
  --set-file litellm.caCertificate=/path/to/ca.crt
```

The dependency preparation step applies the small OpenShell overlay in
`patches/openshell.patch`, which applies the configured
`openshell.resources` to its pre-install certificate-generation Job. Keep or
upstream that patch when refreshing the dependency so the hook can run before
the namespace `LimitRange` exists on a first installation.

When `secrets.existingSecret` is used it must contain `control.toml`,
`runner-token`, `litellm-master-key`, `postgres-password`, `database-url`,
`litellm-ui-username`, `litellm-ui-password`, `litellm-salt-key`,
`metrics-token`,
`hindsight-database-password`, `hindsight-database-url`,
`hindsight-api-key`, and `hindsight-router-token` (the final four are required
when `hindsight.enabled=true`).
`control.toml` contains only the public URL, database and signing bootstrap,
and the initial Platform Administrator credential. The chart supplies Runner,
LiteLLM, internal Control, and Runtime Namespace values as one-time bootstrap
environment values; Control imports them into the Platform database. Later
changes are made under **Platform Setting -> Infrastructure**, where the
complete draft must validate before save. Local authentication policy, OIDC,
and SMTP are also configured after sign-in from Platform Setting. Set
`runner.gatewayEndpoint` when both `openshell.enabled=false` and
`runner.projectTargetRouting.enabled=false` and the Gateway is managed outside
this release. Set `runner.workspace` to the same OpenShell workspace used by
that Gateway; service routes include this value as their first hostname
segment. In Project target-routing mode, the Project Namespace is also the
workspace and those two legacy settings are not used for target selection.

To deliver Project invitations, sign in as a Platform Administrator and
configure **Platform Setting -> Email delivery**. Port 587 uses STARTTLS; use
implicit TLS for port 465. SMTP settings and the encrypted password are stored
only in PostgreSQL and have no values-file or `control.toml` fallback.

## Disconnected / air-gapped installation

The released Control Plane image contains the complete packaged Chart,
including OpenShell, Agent Sandbox, their CRDs, and the Agent Sandbox upstream
license:

```text
/opt/tali/helm/tali-relay.tgz
```

The runtime image intentionally does not include the Helm CLI. Extract the
archive and render it with the Helm binary already approved for the
disconnected environment without contacting a Helm or OCI repository:

```bash
CONTROL_IMAGE=registry.internal.example.com/tali-control:<version>
CONTAINER_ID="$(podman create "${CONTROL_IMAGE}")"
podman cp \
  "${CONTAINER_ID}:/opt/tali/helm/tali-relay.tgz" \
  ./tali-relay.tgz
podman rm "${CONTAINER_ID}"

tar -xzf tali-relay.tgz
cp tali-relay/values-airgap.yaml ./my-airgap-values.yaml
# Replace registry.airgap.example.com and airgap-registry in the copied file.

helm template tali-relay ./tali-relay \
  --namespace tali \
  --include-crds \
  --values tali-relay/values-openshift.yaml \
  --values ./my-airgap-values.yaml \
  > tali-openshift.yaml
```

`values-airgap.yaml` mirrors every image family independently: TaskLattice Relay
images through `global.imageRegistry`, PostgreSQL and Keycloak through
`images.*`, Agent Sandbox through `agentSandbox.image`, and the OpenShell
gateway, supervisor, and default sandbox through their respective `openshell`
values. Do not put a full image repository under a first-party
`images.<name>.repository` unless `useGlobalRegistry=false`; normally set
`global.imageRegistry` once and keep those repository names relative.
The profile also pins LiteLLM to one worker and sets
`LITELLM_LOCAL_MODEL_COST_MAP=True`; pricing and model context metadata come
from the JSON bundled in `tali-litellm`, not from GitHub at startup.

Before installing, create the release namespace and its registry pull Secret.
The Agent Sandbox controller and webhook are installed into that same namespace:

```bash
oc new-project tali
oc -n tali create secret docker-registry airgap-registry \
  --docker-server=registry.internal.example.com \
  --docker-username='<username>' \
  --docker-password='<password>'
```

Dependency preparation (`npm run helm:dependencies`) needs network access and
is a build-time operation only. Do not run it in the disconnected environment;
use the `.tgz` embedded in the released Control Plane image.

## OpenShift

Use `values-openshift.yaml` when the OpenShift administrator permits the
`anyuid` SCC. The images retain their tested, non-root UID/GID values; no
arbitrary-UID `HOME=/tmp` image adaptation is required. The profile binds the
release's dedicated Runtime, Control, and OpenShell gateway ServiceAccounts to
`anyuid`, changes externally facing Services to `ClusterIP`, creates an
edge-terminated Control Route, omits OpenShell's structured AppArmor field,
and applies restrictive security contexts to the Agent Sandbox controller.

OpenShell sandbox pods are the intentional exception. They require root,
network/process capabilities, and the `privileged` SCC. The OpenShift profile
therefore creates a namespaced RoleBinding to
`system:openshift:scc:privileged`. This is suitable only for an isolated,
trusted evaluation project, and the Helm installer must be allowed to bind
that ClusterRole. Set `openshift.anyuidScc.createRoleBinding=false` and/or
`openshift.sandboxScc.createRoleBinding=false` when a cluster administrator
manages the corresponding SCC grants separately.

The Chart also installs CRDs, ClusterRoles, ClusterRoleBindings, and the Agent
Sandbox controller in the release namespace. A cluster administrator must perform the first
installation, or install those cluster-scoped dependencies separately and set
`agentSandbox.enabled=false`.

Example:

```bash
NAMESPACE=tali
APPS_DOMAIN="$(oc get ingresses.config.openshift.io cluster \
  -o jsonpath='{.spec.domain}')"
CONTROL_HOST="tali.${APPS_DOMAIN}"

oc new-project "${NAMESPACE}"
helm upgrade --install tali-relay charts/tali-relay \
  --namespace "${NAMESPACE}" \
  --values charts/tali-relay/values-openshift.yaml \
  --set-string "control.publicUrl=https://${CONTROL_HOST}" \
  --set-string "openshift.routes.control.host=${CONTROL_HOST}" \
  --wait \
  --wait-for-jobs \
  --timeout 30m
```

The Control Route is intended for browser and HTTP/WebSocket traffic. The
OpenShell gateway remains internal because its API uses gRPC; use port
forwarding for private evaluation or configure OpenShell's `grpcRoute` with a
supported Gateway API implementation. Do not expose the default plaintext,
unauthenticated OpenShell configuration publicly.

This Chart deploys `pgvector/pgvector:0.8.6-pg17`, which extends the Docker
Official PostgreSQL 17 image with pgvector, and mounts
`/var/lib/postgresql/data`. A database log referring to
`/opt/bitnami/postgresql` comes from an image override or a different release;
do not substitute an image without pgvector or a Bitnami image without also
replacing its environment and volume configuration.

The pgvector image runs PostgreSQL as UID/GID `999`; the StatefulSet security
context matches it. Releases created with the former Alpine image used UID/GID
`70`. Before upgrading an existing PVC, take a tested backup and arrange a
maintenance-window ownership migration for the data volume. Do not weaken the
Pod to run as root as an upgrade shortcut.

## Project Durable Memory provider (Hindsight)

The product feature is enabled by default with
`features.durableMemory.enabled=true`. To stage a release, set
`features.durableMemory.projectAllowlist` to the exact Project IDs that may
create and manage Durable Memory. A non-empty allowlist takes precedence over
the environment default. Projects outside it keep the existing Agent creation
path, but no Memory is auto-provisioned and the Memory navigation/API surface
is unavailable. Existing bound runtimes continue through the scoped Memory
Gateway so a rollout change does not interrupt an in-flight Agent response.

Durable Memory uses Hindsight API `0.9.2-slim`, pinned to the reviewed
multi-architecture OCI index digest
`sha256:7635a15739361dbdf221ba796ad25a813f876144fe113022eea8e26cb6ee75e7`.
The Service is always `ClusterIP`; only Control and Control Worker are allowed
to call it. Agent runtimes never receive the Hindsight root API key or choose a
Bank ID. Product access is mediated by Relay's project-scoped Memory boundary.
Each OpenClaw or Hermes Runtime receives one signed coordinator credential
fixed to its active Project, Instance, and Memory binding. The Project Runtime
Bridge exposes only `recall` and `retain`; request bodies cannot select a Bank,
Project, or Memory. Recall is fail-open and bounded by
`hindsight.runtimeRecallTimeoutMs` (1500 ms by default), while retain only
enqueues Relay's encrypted Outbox and is delivered asynchronously.

Hindsight shares the release PostgreSQL server and pgvector extension, but its
tables are owned by the dedicated `hindsight` database user in the dedicated
`hindsight` database and schema. Relay migrations do not touch that schema and
Relay application code does not query it. A version-hashed, ordinary Kubernetes
Job first creates the role/database/schema and then runs:

```text
hindsight-admin run-db-migration --schema hindsight --embedding-dimension <configured-dimension>
```

API startup migrations remain disabled. The normal Job and Hindsight's
database advisory locking make a Helm/Argo retry safe without turning the
migration into a lifecycle hook. Keep `hindsight.models.embeddingDimensions`
equal to the vector length returned by every Project embedding Model admitted
to shared Hindsight before running an upgrade. The Project Router rejects a
mismatched response before Hindsight can persist it.

The following names are stable Hindsight-side bootstrap names. They do not need
to exist in LiteLLM when the Platform is first installed:

| Value | Default alias | Purpose |
| --- | --- | --- |
| `hindsight.models.llm` | `hindsight-chat` | Fact extraction and provider synthesis |
| `hindsight.models.llmProvider` | `openai` | Hindsight LLM adapter used for the LiteLLM-compatible chat endpoint |
| `hindsight.models.embedding` | `hindsight-embedding` | Document and query embeddings |
| `hindsight.models.embeddingProvider` | `openai` | OpenAI-compatible adapter that propagates Bank attribution to the Project Router |
| `hindsight.models.reranker` | `hindsight-reranker` | Recall reranking |
| `hindsight.models.rerankerProvider` | `rrf` | Local reciprocal-rank fusion; no reranker model is required |

Hindsight never receives the LiteLLM master key. A localhost Project Router
sidecar answers only model-free startup probes until Hindsight is healthy. For
real calls, Hindsight attaches its Bank ID and the Router resolves that Bank to
the owning Project, selects the Project's validated/default Model or Routing,
and calls LiteLLM with a short-lived service key on the Project Team. Missing,
ambiguous, or dimension-incompatible Project configuration fails closed. The
Hindsight API also reads `hindsight-database-url`, `hindsight-api-key`, and the
dedicated `hindsight-router-token` from the release Secret. A placeholder-only
manifest showing the Hindsight keys is available at
[`examples/hindsight-existing-secret.yaml`](examples/hindsight-existing-secret.yaml);
merge those keys with every other key listed for `secrets.existingSecret`.
Never commit rendered or real values.

The API runs its built-in worker by default. Set
`hindsight.worker.enabled=true` only after load testing shows that extraction
must scale independently; that renders a StatefulSet with stable Pod-derived
worker IDs and disables the embedded worker. Both forms keep API and worker
metrics/health endpoints private. Full LLM prompt/completion tracing, 4xx debug
dumps, MCP, and provider Control Plane exposure are disabled by default.

Enable Prometheus Operator integration with
`monitoring.serviceMonitor.enabled=true` and actionable Memory alerts with
`monitoring.prometheusRule.enabled=true`. This scrapes authenticated Relay and
Control Worker metrics plus Hindsight's private `/metrics` endpoint. Set an
independent random `secrets.metricsToken` (or `metrics-token` in
`secrets.existingSecret`). Hindsight Bank ID labels remain disabled and async
backlog metrics are enabled. The complete backup, restore, alert-response,
upgrade, troubleshooting, and uninstall procedure is in
[`docs/durable-memory-operations.md`](../../docs/durable-memory-operations.md).

Verify a deployment with:

```bash
kubectl -n <namespace> wait --for=condition=complete \
  job -l app.kubernetes.io/component=hindsight-migration --timeout=15m
kubectl -n <namespace> rollout status deployment/<release>-hindsight-api --timeout=5m
kubectl -n <namespace> get deployment,service,job,networkpolicy,poddisruptionbudget \
  -l app.kubernetes.io/instance=<release>
kubectl -n <namespace> exec deployment/<release>-hindsight-api -- \
  python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8888/health/live").status)'
```

For an upgrade, back up PostgreSQL, update the Hindsight image tag/digest and
`@vectorize-io/hindsight-client` together, review upstream release notes, run
the repository's live Hindsight integration test, then use `helm upgrade
--wait --wait-for-jobs`. Never point an older Hindsight binary at a schema after
a non-backward-compatible migration. If the new application rollout fails but
the migration succeeded, roll Control back only to a build verified against the
new schema and apply a forward-fix provider release; do not run destructive
down migrations. Restore the database backup only as a coordinated full data
rollback after stopping all Hindsight API/worker Pods.

## Built-in Vector Database document ingestion

The Chart deploys Docling Serve as an independent Deployment and ClusterIP
Service for built-in Vector Database document parsing. It is not a Control Pod
sidecar or an in-process TypeScript dependency. The Control Worker calls its
cluster-local HTTP API through `DOCLING_BASE_URL`:

```text
document upload -> PostgreSQL job -> Control Worker -> Docling Serve
                                      |                 layout/OCR/chunks
                                      +-> LiteLLM embedding -> pgvector
```

Docling performs layout extraction, table understanding, and OCR independently
of the selected embedding Provider; `NVIDIA_API_KEY` and `NVAPI_API_KEY` are not
required. Its model cache uses the `<release>-docling-models` PVC by default.
The large initial image pull and CPU model initialization can make the first
Pod readiness transition take several minutes.

Disable the bundled parser with `docling.enabled=false` only when document
upload is intentionally unavailable or `control.worker.extraEnv` supplies
`DOCLING_BASE_URL` for a separately managed Docling Serve endpoint. Verify a
bundled deployment with:

```bash
kubectl -n <namespace> rollout status deployment/<release>-docling --timeout=1800s
kubectl -n <namespace> get deployment,service,pvc \
  -l app.kubernetes.io/instance=<release>,app.kubernetes.io/component=docling
```

## Embedded Keycloak for end-to-end tests

Set `keycloak.enabled=true` to deploy a test-only Keycloak instance together
with TaskLattice Relay. The Chart imports the `tali` realm, configures the
confidential `tali-control-plane` OIDC client, installs a `groups` Client Scope
that emits complete Group paths, and creates role-focused development profiles.
OIDC and Group Role Bindings remain database-owned and are configured from
Platform Setting after the deployment is reachable.

Keycloak needs a stable URL that is reachable from both the browser and the
Control pod. For a cluster with a reserved load-balancer address:

```bash
helm upgrade --install tali-relay charts/tali-relay \
  --namespace tali \
  --create-namespace \
  --set control.publicUrl=http://192.168.139.2:38080 \
  --set keycloak.enabled=true \
  --set keycloak.publicUrl=http://192.168.139.3:8080 \
  --set keycloak.service.loadBalancerIP=192.168.139.3
```

For local environments where the browser uses a loopback hostname while the
Control pod reaches the same endpoint through the node address, map that
hostname with `control.hostAliases`. For example, OrbStack can use
`keycloak.localhost` in `keycloak.publicUrl` and map it to the OrbStack node IP.
The repository's local deployment script performs this mapping automatically:

```bash
npm run helm:deploy:dev:keycloak
```

Every local deployment idempotently ensures `proj1` and `isolation-1` exist
under `dep1` from `config/development-projects.json`. The Keycloak command also
signs in to Control with the local development administrator,
validates and saves the embedded Keycloak provider through the Control API,
keeps Local authentication enabled, and merges test Group bindings for every
Project discovered under the development Department. If the local
administrator credentials have changed, provide
`CONTROL_LOCAL_ADMIN_USERNAME` and `CONTROL_LOCAL_ADMIN_PASSWORD`.
Set `CONTROL_DEVELOPMENT_PROJECTS_ENABLED=false` to skip these development
fixtures, or point `CONTROL_DEVELOPMENT_PROJECTS_FILE` at a compatible JSON
list to exercise another Project/SLA layout.

The development credentials are:

| Purpose | Username | Password |
| --- | --- | --- |
| Local Relay administration | `admin` | `password` |
| LiteLLM administration | `admin` | `password` |
| Keycloak administration | `admin` | `password` |
| TaskLattice Relay Project Administrator | `alice` | `password` |
| Relay development administrator (all development Project roles) | `adm` | `password` |
| Relay SSO authorization test administrator (all development Project roles) | `sso-admin` | `password` |
| Relay Department Administrator (`dep1` only) | `department-admin` | `password` |
| Relay Project Administrator | `project-admin` | `password` |
| Relay Agent Developer | `developer` | `password` |
| Relay Reviewer | `reviewer` | `password` |
| Relay End User (`ROLE_USER`) | `end-user` | `password` |
| Relay Auditor | `auditor` | `password` |

Override `secrets.keycloakAdminPassword`,
`secrets.keycloakClientSecret`, and `secrets.keycloakTestUserPassword` when
needed. Test user profile fields can be replaced through
`keycloak.testUsers`.

This mode runs Keycloak with `start-dev` and ephemeral storage. Realm changes
are lost when its pod is replaced. It intentionally cannot be combined with
`secrets.existingSecret`, because the Chart must generate matching Keycloak
credentials. For a manual Helm installation, configure its issuer and Client
credentials in **Platform Setting -> Security & SSO**, keep the Group claim as
`groups`, and add the exact test bindings represented by these Group paths:

```text
/tali/r/ROLE_PLATFORM_ADMIN
/tali/d/dep1/r/ROLE_DEPARTMENT_ADMIN
/tali/d/dep1/p/<project-id>/r/ROLE_PROJECT_ADMIN
/tali/d/dep1/p/<project-id>/r/ROLE_AUDITOR
/tali/d/dep1/p/<project-id>/r/ROLE_AGENT_DEVELOPER
/tali/d/dep1/p/<project-id>/r/ROLE_REVIEWER
/tali/d/dep1/p/<project-id>/r/ROLE_USER
```

`adm` and `sso-admin` are both Platform Administrators, `dep1` Department
Administrators, and members of every configured development Project role so the
complete authorization surface can be exercised during development.
All SSO profiles use `secrets.keycloakTestUserPassword`. The remaining users isolate one
administrative scope or Project role each. A
successful SSO sign-in
materializes the corresponding externally managed Project membership and shows
each binding's last-match time in Platform Setting. Use an independently
managed identity provider for production.

## Example MCP Server for integration tests

Set `exampleMcp.enabled=true` to deploy a test-only, in-cluster Streamable HTTP
MCP Server. It exposes the read-only `list_commits` GitHub tool plus three
deterministic tools: `echo_message`, `calculate_sum`, and
`get_platform_status`. The Service is not exposed outside the cluster, requires
HTTP Basic authentication, and is available to LiteLLM at:

```text
http://tali-relay-example-mcp:3000/mcp
```

The test credentials are `Username` / `Password`. LiteLLM accepts the Basic
credential as `username:password` and encodes it when creating the HTTP
Authorization header, so the Chart creates `tali-relay-example-mcp-auth` with
an `auth-value` containing `Username:Password`. Register it with:

```text
auth type: basic
Secret reference: k8s://<namespace>/tali-relay-example-mcp-auth#auth-value
```

Build and deploy the local example together with Keycloak:

```bash
npm run images:build:dev:demo-test
npm run helm:deploy:dev:keycloak:example-mcp
```

The GitHub tool accepts a token from
`exampleMcp.githubTokenSecret.name`/`.key`. The local deployment script creates
that Secret from `GITHUB_TOKEN`, or from the authenticated `gh` CLI when one is
available. The token is never passed as a Helm value or stored in Helm release
metadata.

Register the endpoint as a custom HTTP MCP Server in a Project. TaskLattice Relay
then asks LiteLLM to discover the tools and stores the resulting names,
descriptions, input schemas, and discovery status in the Project database.
This component uses fixed test credentials and must not be enabled in
production.

## Shared database

TaskLattice Relay control and LiteLLM intentionally use the same `database-url`.
LiteLLM owns the PostgreSQL `public` schema; the control plane and its Prisma
migration history live in the compatibility `tasklattice` schema. The control Deployment has
an init container that runs `prisma migrate deploy`, including the SQL migration
that creates the default Project and preconfigured Skill, MCP Server, Knowledge
Source, Agent Role, and policy metadata.

An external database supplied through `secrets.existingSecret` must allow the
configured role to create and modify the `tasklattice` schema. There is no
SQLite mode or control-plane data PVC.
