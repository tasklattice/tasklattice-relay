# TaskLattice Relay Helm Chart

See [component configuration and persistence](../../docs/helm-component-configuration.md)
for the Control/Worker file contract, Hindsight configuration, Docling storage,
and the Base64 CA migration.

This chart installs the complete TaskLattice Relay stack: control/UI, Control
Worker, Docling Serve, OpenShell runner, LiteLLM, PostgreSQL with pgvector,
the internal Hindsight Durable Memory provider, and the optional Agent Sandbox
controller. OpenShell Gateways are provisioned dynamically in Project Namespaces;
the default control-plane release does not deploy a shared Gateway in `tali`.
Its Chart, package, and default Helm release name is `tali-relay`; the examples
use the product-level `tali` Kubernetes namespace.
The Release Workflow selects OpenShell 0.0.116, NemoClaw v0.0.138, and Agent
Sandbox v1.0.2 by explicit upstream tags and does not follow `latest`. Builds
use the content currently published under those tags. Their upstream source is
not copied into this repository, while the released TaskLattice Relay archive
remains self-contained.

Agent Sandbox uses the v1.0.2 source tag and controller image; upstream's Helm
Chart version is still `0.1.0`. Set `agentSandbox.enabled=false` to reuse an
existing cluster controller (see `values-uat.yaml`). Keep it `true` only when
this release owns the cluster-wide controller. For a separate local release,
run `npm run helm:deploy:agent-sandbox`, then deploy Relay with
`AGENT_SANDBOX_ENABLED=false`. See the
[upgrade comparison, configuration, and compatibility tests](../../docs/agent-sandbox-v1.0.2.md).

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

`control.publicUrls` is a nonempty list of allowed browser origins, independent
of `control.service.type`. Include scheme and non-default port. Authentication
redirects and invitation links follow the caller's validated origin; there is no
canonical-domain redirect. For a TLS-terminating ingress, set
`control.trustProxyHeaders=true` only if it overwrites forwarded host/protocol
headers. The embedded Keycloak client registers callbacks for every listed origin.

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

The pre-install/pre-upgrade credential Job initializes interactive login passwords
to `password`, generates independent database/service credentials and keys, and stores
them in Kubernetes Secrets. Helm values and rendered manifests contain no initial
credential values. Repeated initialization preserves credentials. See
[credential initialization](../../docs/helm-credential-bootstrap.md) for retrieval,
external credential-store contract and automatic OCP bootstrap image-pull preparation.

### Default values and advanced overrides

`values.yaml` lists deployment choices: public origins and exposure, images and
pull credentials, resources and storage, runtime limits, and optional components.
Component configuration Secrets are generated from one credential store. Argo CD
sync order, Gateway release name/service prefix/chart path, and the embedded
Keycloak test identities are built into the Chart.

Two optional integrations have dedicated examples:

| Integration | Example |
| --- | --- |
| Project visibility in Argo CD | [Project tracking annotations](examples/project-runtime-argocd-values.yaml) |
| External document parser | [External Docling](examples/external-docling-values.yaml) |

Use current defaults plus the overrides needed by the installation. Removed
settings fail rendering; they are not translated into new configuration.

Keep image versions explicit for compatible and reproducible runtimes. Resource
requests/limits, persistence, security contexts, CA trust, service ports, timeouts,
and controller ownership are operational choices. The Durable Memory feature
switch is distinct from deploying Hindsight; disabling the feature need not
remove its provider workload. These settings retain their current semantics.

Before publishing, run `npm run test:chart-credentials` and
`npm run helm:validate:credentials`.

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

Every Project has an opaque, stable `tp-<16-character-base32>` Namespace.
Project creation ensures the Namespace before returning success. Its annotations
preserve the exact Project name; a DNS-safe name is also stored as a label.
`projectRuntimeNamespaces.clusterId` seeds the initial Platform Infrastructure
setting when the database has no runtime configuration.

Control Worker, Project Namespaces, Project Gateways, and Project routing are
always enabled by the Chart. Worker installs the pinned official OpenShell
chart as a separate Helm release in each Project Namespace. The Gateway uses that
Namespace for Sandboxes, with a private `ClusterIP` Service and the upstream
Sandbox SSH NetworkPolicy. Relay does not add its own network policies.
Its image, resources and pull Secrets come from `openshell.*` values. The
OpenShell chart is bundled into the Worker image for this purpose; it is not a
Relay Helm dependency and is never deployed in the Control namespace.

The main Control Plane ServiceAccount has diagnostic read access. The Control
Worker creates Namespaces and installs the per-Project OpenShell releases through
a PostgreSQL-backed durable queue, which also handles delayed Project deletion
and periodic Namespace plus Gateway repair. Runtime workloads receive neither identity.

`npm run helm:dependencies` prepares only the Agent Sandbox dependency and
validates the Relay render and Worker configuration. The standalone
`helm:deploy:agent-sandbox` command also prepares only Agent Sandbox.

`npm run helm:package:worker` downloads and patches OpenShell, verifies its
Gateway and Supervisor image versions, and writes `dist/worker-charts/openshell.tgz`.
The shared Control/Worker image build runs this step and copies that artifact to
`/opt/tali/helm/openshell.tgz`. Only Worker consumes it. OpenShell is absent from
the Relay chart archive; release image inventories validate the separate Worker
artifact so dynamically deployed images remain available offline.
Operators can also repair all mappings with the packaged one-shot command:

```bash
kubectl -n <control-namespace> exec deployment/<release>-control-worker -- \
  node apps/control/.output/tools/project-runtime-reconcile.mjs
```

OpenShell 0.0.116 fixes one Kubernetes sandbox Namespace per Gateway. The
architecture runs one Gateway per Project and one central Runner. Every Agent lifecycle, audit, terminal, and Web UI operation
carries the stable Project Runtime Target; the Runner derives the trusted
Gateway Service address as
`http://openshell-<namespace>.<namespace>.svc.cluster.local:8080`. Worker uses the
same fixed prefix when naming the Gateway Service. Runner never accepts a Gateway URL
from an API request. Agent Web UI uses the authenticated Control path
`/<projectId>/<instanceId>/ui/`; Control forwards HTTP/WebSocket traffic through
Runner's private 9090 API. The internal OpenShell Host base is fixed to
`http://openshell.localhost:8080` and requires no public DNS or separate ingress.

Helm rejects obsolete topology and routing settings. See
[Project Runtime Namespaces](../../docs/project-runtime-namespaces.md).

Keep `control.publicUrls` as the browser-origin allowlist and configure
`control.trustProxyHeaders` according to the ingress. Agent UI uses that same
Control origin. Gateway routing and ownership require no additional values.

### Project resource tree and read-only Argo CD visibility

Project resource ownership is always enabled by the Chart. Project roots
(OpenShell workloads and its dedicated RBAC, Runtime Bridge, managed/expert Agent
workloads, Sandbox CRs, and unowned PVCs) reference the actual Project Namespace
UID. Existing controller references are preserved: Gateway Pods retain their
workload controller, and Agent Pods and workspace PVCs belong to their Sandbox. No new CRD is introduced.
Sandbox ownership is reconciled when Control observes provisioning or ready
Instances; it also repairs existing Instances during normal observation.

To show API-created Project Namespaces in an existing Argo CD Application, use the
[advanced Argo CD values example](examples/project-runtime-argocd-values.yaml).
Copy the **exact tracking annotation of an existing visible resource** into
`projectRuntimeNamespaces.argocd.sourceTrackingId` and match its installation ID
when configured. These optional keys are omitted from the default values;
omitting the entire `argocd` object or either field is supported.

Only `projectRuntimeNamespaces.clusterId` seeds a missing database setting;
later cluster-ID changes belong in **Platform Setting -> Infrastructure**.
Argo CD overrides are read directly from Worker deployment configuration after
rollout and are not imported into Platform Settings.

This opt-in integration requires Argo CD's `annotation` or `annotation+label`
tracking mode and permission to watch the Project Namespaces and resource kinds.
The copied tracking ID deliberately identifies the existing source, not the new
Project Namespace. Argo CD's documented non-self-referencing behavior makes the
Namespace visible without comparing or pruning it. `Prune=false,Delete=false`
adds explicit deletion protection. Children use Kubernetes ownership, not copied
Application labels. Argo CD users should have viewing permissions only for these
business resources; these annotations do not grant or restrict UI RBAC.

All business creation/deletion remains with Relay APIs. `ownerReferences` still
participates in Kubernetes garbage collection: deleting the Project Namespace
deletes its dependents. Namespace containment alone does not make a Namespace
appear in an Argo Application. With an empty `sourceTrackingId`, no Argo tracking
annotations are written; existing namespace tracking can be used instead.

OpenShell ownership uses the Helm 3 post-renderer bundled in the Control image
(Helm 3.19.0). Gateway PVC metadata is reconciled after Helm installation to avoid
changing immutable StatefulSet claim templates. It retains the normal storage
lifetime across Pod replacement. The provisioner also reconciles certgen hook
RBAC and generated Secrets, which Helm excludes from post-rendering.
See [Argo CD resource tracking](https://argo-cd.readthedocs.io/en/stable/user-guide/resource_tracking/#non-self-referencing-annotations).

Run `npm run test:project-resource-ownership` for chart ownership checks. Local
cluster acceptance uses `HELM_BIN=/path/to/helm3 KUBE_CONTEXT=orbstack npm run
test:e2e:project-resource-ownership`; it creates and removes an isolated Project
Namespace and requires an installed Sandbox controller and cached Runner image.

Workload rollout checksums are component-scoped. Updating Control-only
settings such as `control.publicUrls` restarts the Control Deployment but does
not roll Runner, LiteLLM, or PostgreSQL. Changing a Service type by itself does
not restart application Pods.

## Argo CD sync order

The parent chart owns the Control Plane's Argo CD sync-wave policy. Agent
Sandbox dependency resources keep the default sync wave `0`. Project OpenShell
releases are installed separately by Control through Helm, including their
upstream `pre-install,pre-upgrade` certificate hooks. They do not participate in
the Control Application's sync sequence.

TaskLattice Relay resources are deliberately later than the dependencies:

| Wave | Resources |
| ---: | --- |
| `-10` | Namespace `LimitRange` and optional OpenShift SCC RoleBindings required by dependency admission |
| `0` | Agent Sandbox dependency resources (unmodified default) |
| `10` | TaskLattice Relay ServiceAccounts, RBAC, Secrets, ConfigMaps, and Services, including the internal Hindsight Service |
| `20` | PostgreSQL StatefulSet and the version-scoped Hindsight migration Job |
| `30` | LiteLLM and optional Keycloak Deployments |
| `40` | Control, Control Worker, Runner, Hindsight API, and optional example MCP Deployments |
| `50` | Optional OpenShift Routes |

Argo CD waits for each wave to become healthy before advancing. The Chart fixes
this order to match component dependencies. Plain Helm and Kubernetes ignore
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

To trust endpoints signed by a private CA, set `litellm.caCertificateBase64`
to Base64 of a PEM certificate bundle. The previous `caCertificate` field is
rejected. For example:

```sh
base64 < /path/to/ca.crt | tr -d '\n' > /tmp/relay-ca.b64
helm upgrade --install tali-relay charts/tali-relay \
  --set-file litellm.caCertificateBase64=/tmp/relay-ca.b64
```

Helm rejects invalid Base64/non-PEM input. The non-root `build-ca-bundle` init
container validates X.509 and merges private CAs with the image's public CA
roots in `/var/run/tali-ca/ca-bundle.pem`. LiteLLM receives `SSL_CERT_FILE`,
`REQUESTS_CA_BUNDLE`, and `CURL_CA_BUNDLE`; `/etc/ssl/certs` is never hidden or
modified. Certificate changes trigger a rollout. If initialization fails,
inspect `kubectl logs <pod> -c build-ca-bundle` for the certificate error.

The Worker chart packaging step applies the small OpenShell overlay in
`patches/openshell.patch`, which applies the configured
`openshell.resources` to its pre-install certificate-generation Job. Keep or
upstream that patch when refreshing the dependency so the hook can run before
the namespace `LimitRange` exists on a first installation.

The Job derives each component configuration Secret from one retained credential
store. Worker configuration remains a Helm-rendered Secret. Component Secret
names and contents are managed by the Chart:

| Component | Secret suffix |
| --- | --- |
| `control` | `control-config` |
| `worker` | `worker-config` |
| `runner` | `runner-config` |
| `postgresql` | `postgresql-config` |
| `litellm` | `litellm-config` |
| `hindsight` | `hindsight-config` |
| `metrics` | `metrics-config` |
| `keycloak` | `keycloak-config` |
| `exampleMcp` | `example-mcp-auth` |

Names are prefixed with the release fullname. `<fullname>-credentials` is only
read by the bootstrap Job; applications mount their component-specific Secrets.
The shared source keeps cross-component credentials consistent. To supply
credentials from a Secret manager, use `credentialBootstrap.existingSecret` with
the complete key set documented in [credential initialization](../../docs/helm-credential-bootstrap.md).
The Job reads that source and generates every enabled component's configuration.

`control.toml` includes typed deployment settings and one-time bootstrap values
for Platform Infrastructure. Saved Infrastructure, SSO and SMTP settings remain
database-owned. Tenant provisioners are under `[worker.*]` in Worker-only `worker.toml`; Runner's separate
`runner.json` contains its Sandbox execution and Project Gateway routing settings.
See [component configuration](../../docs/helm-component-configuration.md) for the
complete ownership and initialization image contracts.

To deliver Project invitations, sign in as a Platform Administrator and
configure **Platform Setting -> Email delivery**. Port 587 uses STARTTLS; use
implicit TLS for port 465. SMTP settings and encrypted credentials are stored
only in PostgreSQL and have no values-file or `control.toml` fallback.

## Disconnected / air-gapped installation

The released shared Control/Worker image contains the complete Relay Chart,
including Agent Sandbox, its CRDs and upstream license:

```text
/opt/tali/helm/tali-relay.tgz
```

The image also carries `/opt/tali/helm/openshell.tgz` and the Helm CLI for Worker's
Project installs. Extract the Relay archive and render it with the Helm binary approved for the
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

`values-airgap.yaml` sets `openshift.runtimeImages.enabled=false` to keep direct
external-registry pulls, and mirrors every image family independently: TaskLattice Relay
images through `global.imageRegistry`, PostgreSQL and Keycloak through
`images.*`, Agent Sandbox through `agentSandbox.image`, and the OpenShell
gateway, supervisor, and default sandbox through their respective `openshell`
values. Do not put a full image repository under a first-party
`images.<name>.repository` unless `useGlobalRegistry=false`; normally set
`global.imageRegistry` once and keep those repository names relative.
The profile also pins LiteLLM to one worker and sets
`LITELLM_LOCAL_MODEL_COST_MAP=True`; pricing and model context metadata come
from the JSON bundled in `tali-litellm`, not from GitHub at startup.

Before installing, create the release namespace and its registry pull Secret
from an authenticated registry configuration file. The Agent Sandbox controller
and webhook are installed into that same namespace:

```bash
oc new-project tali
oc -n tali create secret generic airgap-registry \
  --type=kubernetes.io/dockerconfigjson \
  --from-file=.dockerconfigjson=/path/to/registry-config.json
```

Dependency preparation (`npm run helm:dependencies`) needs network access and
is a build-time operation only. Do not run it in the disconnected environment;
use the Relay `.tgz` embedded in the released shared Control/Worker image.
Worker uses its separate image-bundled OpenShell chart without downloading it.

## OpenShift

Use `values-openshift.yaml` when the OpenShift administrator permits the
`anyuid` SCC. The images retain their tested, non-root UID/GID values; no
arbitrary-UID `HOME=/tmp` image adaptation is required. The profile binds the
release's dedicated Runtime, Control, and Control Worker ServiceAccounts to
`anyuid`, changes externally facing Services to `ClusterIP`, creates an
edge-terminated Control Route, and applies restrictive security contexts to
the Agent Sandbox controller.

With `openshift.enabled=true`, Worker prepares SCC grants in each Project
Namespace before installing Gateway/certgen or starting runtime Pods:

- The pinned OpenShell 0.0.116 Sandbox SA receives `system:openshift:scc:privileged`
  for its supervisor capabilities (including init containers in the same Pod).
- Gateway and certgen SAs receive `system:openshift:scc:anyuid`; enabled Bridge
  and Expert runtimes currently use the tenant `default` SA, which also receives anyuid.
- Only Worker gets `bind` authority for these two named ClusterRoles. This does
  not grant Worker itself privileged SCC use. Image-puller authorization remains separate.

Existing tenants receive the same bindings during periodic reconciliation; missing
bindings are recreated without replacing SAs, Secrets or PVCs. Bindings belong to
the Namespace, not the tenant Helm release, so interrupted Gateway install recovery
does not remove them. Foreign bindings or immutable roleRef conflicts fail explicitly.
Set `openshift.manageTenantScc=false` when the platform provides these grants;
this disables further management but does not revoke existing bindings. Old values
without this setting default to automatic management. Ordinary Kubernetes does not
receive SCC bindings or Worker SCC bind authority. Upgrade the shared Control/Worker
image and Control Chart together for this feature. See the
[OCP acceptance guide](../../docs/ocp-image-pull-upgrade-acceptance.md#6-两类租户的-rolebindingsascc-与工作负载).

The Control Chart creates no Gateway or Sandbox SCC binding in its own namespace. Set
`openshift.anyuidScc.createRoleBinding=false` when the platform manages the
Control namespace's grant separately. This profile validates the static Control
Plane; real OCP admission and Sandbox startup still require cluster acceptance.

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
  --set-string "control.publicUrls[0]=https://${CONTROL_HOST}" \
  --set control.trustProxyHeaders=true \
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

Durable Memory uses Hindsight API `1.1.0-slim`, pinned to the reviewed
multi-architecture OCI index digest
`sha256:b97af4787f35f0f897cc85299e1c800e265ff98e1d70c900c58a7f9903cb5b7d`.
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
Hindsight API, Worker and migration read `hindsight-config.json` from their
own bootstrap-managed Secret. Change provider settings through `hindsight.*`
values; the bootstrap Job regenerates the component configuration.

The API runs its built-in worker by default. Set
`hindsight.worker.enabled=true` only after load testing shows that extraction
must scale independently; that renders a StatefulSet with stable Pod-derived
worker IDs and disables the embedded worker. Both forms keep API and worker
metrics/health endpoints private. Full LLM prompt/completion tracing, 4xx debug
dumps, MCP, and provider Control Plane exposure are disabled by default.

Enable Prometheus Operator integration with
`monitoring.serviceMonitor.enabled=true` and actionable Memory alerts with
`monitoring.prometheusRule.enabled=true`. This scrapes authenticated Relay and
Control Worker metrics plus Hindsight's private `/metrics` endpoint. The bootstrap
Job supplies the same independent `metricsToken` to Control and the monitoring
Secret. Hindsight Bank ID labels remain disabled and async
backlog metrics are enabled. The complete backup, restore, alert-response,
upgrade, troubleshooting, and uninstall procedure is in
[`docs/durable-memory-operations.md`](../../docs/durable-memory-operations.md).

Verify a deployment with:

```bash
kubectl -n <namespace> wait --for=condition=complete \
  job -l app.kubernetes.io/component=hindsight-migration --timeout=15m
kubectl -n <namespace> rollout status deployment/<release>-hindsight-api --timeout=5m
kubectl -n <namespace> get deployment,service,job,poddisruptionbudget \
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
cluster-local HTTP API through `[worker.docling]` in Worker-only `worker.toml`:

```text
document upload -> PostgreSQL job -> Control Worker -> Docling Serve
                                      |                 layout/OCR/chunks
                                      +-> LiteLLM embedding -> pgvector
```

Docling performs layout extraction, table understanding, and OCR independently
of the selected embedding Provider; `NVIDIA_API_KEY` and `NVAPI_API_KEY` are not
required. Its model cache uses the `<release>-docling-models` PVC by default.
An init container seeds the image-bundled models into the PVC; Docling reads
that exact path through its native YAML config. `fsGroup` makes it writable by
the non-root process. A startup probe covers slow CPU model initialization.
Persistent deployments use `Recreate`; multiple replicas require RWX storage.
`docling.persistence.existingClaim` supports an operator-managed claim.
The PVC holds models/cache only. Original documents, parsed content, ingestion
jobs and embeddings are persisted in PostgreSQL/pgvector on the PostgreSQL PVC.

Disable the bundled parser with `docling.enabled=false` only when document
upload is intentionally unavailable or `control.worker.docling.url` supplies
a separately managed Docling Serve endpoint (`apiKey` is optional). Verify a
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
  --set-string "control.publicUrls[0]=http://192.168.139.2:38080" \
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

The local script deploys directly into OrbStack and exposes Control at
`http://localhost:38080`, LiteLLM at `http://localhost:4000`, and Keycloak at
`http://keycloak.localhost:8180`. OrbStack provides the Service port forwarding;
no local CA, certificate issuance, or additional proxy is required.

`control.accessLog.enabled=true` records method, fixed route category, transport,
status and duration. It never emits supplied URLs, query strings, cookies,
Authorization headers, or upstream error text. If you add an ingress or APM,
apply the same policy there; application redaction cannot sanitize another
component's access logs. In particular, never record `/_agent-ui/` capability URLs.

Every local deployment idempotently ensures Projects named `proj1` and
`Isolation 1` exist under `dep1` from `config/development-projects.json`, matching
by Department and name. Their IDs are generated by Control as `tp-` plus 13
Base32 characters and are also their Namespace names; the fixture file does
not specify IDs. The Keycloak command also
signs in to Control with the local development administrator,
validates and saves the embedded Keycloak provider through the Control API,
keeps Local authentication enabled, and merges test Group bindings for every
Project discovered under the development Department. Development Keycloak
Group aliases come from the fixture's optional `keycloakGroup` (such as
`isolation-1`), while each binding targets the actual generated Project ID.
Other Projects use their ID as the Group name.
Set `CONTROL_DEVELOPMENT_PROJECTS_ENABLED=false` to skip these development
fixtures, or point `CONTROL_DEVELOPMENT_PROJECTS_FILE` at a compatible JSON
list to exercise another Project/SLA layout.

All fresh installations use `password` for initial interactive login passwords,
including the base Chart, development, UAT, OpenShift, and air-gap profiles.
Relay, LiteLLM and Keycloak administrator usernames remain `admin`; SSO uses the
configured test usernames. PostgreSQL, Hindsight and per-Project OpenShell
database passwords, Example MCP Basic Auth, machine tokens, signing/encryption
keys and salts remain independently random. `credentialBootstrap.developmentMode` is no longer used.

Local deployment helpers read the stored Relay initial administrator credential.
An existing credential store is always reused, including older random passwords.
After an account changes its password, the application's stored password takes
precedence over the bootstrap value; rerunning the Job does not reset accounts.
Test users and Project aliases are fixtures in `files/keycloak-test-identities.yaml`;
their initial passwords come from the bootstrap credential store. Configure a
separate OIDC provider through Platform Settings for custom identity management.

This mode runs Keycloak with `start-dev` and ephemeral storage. Realm changes
are lost when its pod is replaced. For a manual Helm installation, configure its issuer and Client
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
All SSO profiles use the shared SSO credential from the credential store. The remaining users isolate one
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

The test username defaults to `Username`; the initial credential is generated in
`tali-relay-example-mcp-auth`. Its `auth-value` contains the combined Basic credential.
Register it with:

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
This component uses credentials generated by the initialization Job. It is a
development test service and must not be enabled in production.

## Shared database

TaskLattice Relay control and LiteLLM intentionally use the same `database-url`.
LiteLLM owns the PostgreSQL `public` schema; the control plane and its Prisma
migration history live in the `tasklattice` schema. Control and Worker each have
an init container that runs `prisma migrate deploy`, including the SQL migration
that creates the default Project and preconfigured Skill, MCP Server, Knowledge
Source, Agent Role, and policy metadata.

An external database supplied through Control and LiteLLM component Secrets must allow the
configured role to create and modify the `tasklattice` schema. There is no
SQLite mode or control-plane data PVC.

### Development database baseline

Relay owns one SQL migration:
`20260919000000_initial_control_plane/migration.sql`. It initializes the complete
`tasklattice` schema and built-in seed data, including Worker runtime settings,
Project resource operations, vector storage and memory metadata. Tests consume
the same baseline. LiteLLM's `public` schema, Hindsight's separate database and
PgBoss's queue schema remain managed by their upstream components.

This baseline targets a fresh database; earlier development migration histories
are not supported. Use a fresh development database or PostgreSQL volume when
switching from an older baseline. Reinstalling Helm or rebuilding an image does
not clear a retained PVC: reusing one can cause duplicate-object errors followed
by Prisma `P3009`. The chart never resets an existing database automatically.

Project and Agent Garden resource creation/removal run as durable Worker jobs.
Control has read-only cluster diagnostics permissions. See
[asynchronous resource lifecycle](../../docs/project-resource-lifecycle.md) for
status, retries and deployment requirements.


### Shared OpenShift images for dynamic tenants

The OCP profile (`values-openshift.yaml`) explicitly enables
`openshift.runtimeImages.enabled=true`. The base Chart defaults to `false`, so
upgrading an existing deployment with only `openshift.enabled=true` preserves its
original image URLs. Opt in after importing all runtime images.
Every Chart-managed tenant image is resolved as
`<registry>/<source-namespace>/<last repository component>:<original tag>`
(or the original digest). The registry defaults to
`image-registry.openshift-image-registry.svc:5000`; the source defaults to the
Relay release namespace. This covers Gateway/certgen, Supervisor, default Sandbox,
OpenClaw/Hermes/DeepAgents Sandboxes, runtime bridge and expert runtime. Worker
preflight and Runner creation use the same resolved platform Sandbox images.

```yaml
openshift:
  enabled: true
  imageSourceNamespace: "" # reuse the control-plane release namespace
  imageRegistryHost: ""   # internal registry service; or your route host[:port]
  runtimeImages:
    enabled: true
```

Import/mirror the corresponding images **before** upgrading. With the default
repositories, the required ImageStream names and version sources are:

| Tenant image | ImageStream name | Tag source |
| --- | --- | --- |
| Gateway and certgen | `gateway` | `openshell.image.tag` |
| Supervisor | `supervisor` | `openshell.supervisor.image.tag` |
| Default Sandbox | `sandbox-base` | tag/digest in `openshell.server.sandboxImage` |
| OpenClaw | `tali-nemoclaw-sandbox` | `images.openclawSandbox.tag` |
| Hermes | `tali-nemoclaw-hermes-sandbox` | `images.hermesSandbox.tag` |
| DeepAgents | `tali-nemoclaw-deepagents-sandbox` | `images.deepagentsSandbox.tag` |
| Runtime bridge | `tali-control` | `images.control.tag` |
| Expert runtime | `tali-expert-agent-runtime` | `images.expertAgentRuntime.tag` |

Empty `images.*.tag` values use Chart `appVersion`. Existing custom repository
basenames are preserved: `mirror/team/openshell-gateway` maps to
`<registry>/<source-namespace>/openshell-gateway`, not `gateway`. Preserve unique
basenames when mirroring images from different upstream paths. The Chart rejects
invalid ImageStream names/tags and different upstream references that collapse onto
the same target tag. Put Gateway/Supervisor versions in their `tag` fields, not
inside `repository`. The Chart does not
create/import ImageStreams or change control-plane Pod/bootstrap image URLs.
ImageStream updates do not automatically restart existing Agent instances.

For an existing OCP deployment that has not mirrored every runtime image, set
`openshift.runtimeImages.enabled=false` to retain explicit mixed-registry URLs.
The OCP profile enables unified image mapping; keep a final override of `false`
until images are ready. Apply the external-registry `values-airgap.yaml` **after**
`values-openshift.yaml`, as shown in the offline installation example. Ordinary Kubernetes (`openshift.enabled=false`) preserves all
original image URLs regardless of the runtimeImages setting.

The Chart generates Worker and Runner image references together, including
Worker `sandboxImages` and Runner `openshell.sandbox.images`.
Per-instance `sandboxImage` overrides remain explicit and are not rewritten. Worker grants each Project SA group pull access in the source and waits
for tenant-local pull credentials, bounded by `openshift.imagePullReadyTimeoutMs`
(default 120000). Deploy the updated Worker image and chart together; the image
bundles the certgen existing-SA patch. See
[cross-namespace pulling and upgrade acceptance](../../docs/openshell-install-troubleshooting.md#openshift-cross-namespace-imagestream-pulling).

## Built-in Demo Agent images

UI-created GitHub Daily Triage, Pull Request Risk Scanner, and Support Escalation
Router Instances use `images.exampleMcp`, independently of `exampleMcp.enabled`.
That switch controls only the optional Example MCP Deployment in the control
namespace. The same image setting is written to `[demo_agents]` in `control.toml`
and consumed by Control Worker when creating tenant Demo workloads.

```yaml
images:
  exampleMcp:
    repository: demo-test
    tag: "<release-tag>"
    pullPolicy: IfNotPresent
```

The default source is `global.imageRegistry/demo-test:<release-tag>`. To use a
complete private repository without the global prefix:

```yaml
images:
  exampleMcp:
    repository: registry.internal.example.com/relay/demo-test
    useGlobalRegistry: false
    tag: "<release-tag>"
    pullPolicy: IfNotPresent
```

With `openshift.enabled=true` and `openshift.runtimeImages.enabled=true`, tenant
Demo images are rewritten to the configured OCP registry and source namespace,
just like Bridge and Sandbox images. The OCP import-plan script includes the
Demo ImageStream even when `exampleMcp.enabled=false`. Import it before creating
a Demo Instance. The control-namespace Example MCP Deployment retains the
normal `tali.image` address. For digest pinning use `tag: "<tag>@sha256:<digest>"`.

Demo workloads honor `global.imagePullSecrets`; these are references to Secrets
in the **tenant namespace**, not copies from the control namespace. OCP internal
pulls also wait for the tenant default SA's ready pull credentials. The default
SA's cross-namespace image-puller grant is established during Project
initialization. Ordinary Kubernetes keeps explicit registry addresses and uses
the configured pull policy and Secret references.

Upgrade the Chart and Control/Worker image together. Changed Demo settings roll
both Control and Worker through their configuration checksum. Existing built-in
catalog entries resolve the deployed settings when displayed or instantiated,
so old `:dev` references or cached catalog digests do not override new settings.
No catalog reset is required. Existing running Instances are not restarted by
catalog reads; retry a failed creation after upgrading to use the new image.
User-registered Agent images remain user-controlled. Image digest pinning keeps
the configured registry/repository even if the container runtime reports an
upstream GHCR reference.

The Chart generates `[demo_agents]` (`image`, `imagePullPolicy`,
`imagePullSecrets`) for Control from the same image settings used by Worker.
