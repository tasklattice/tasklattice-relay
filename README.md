# TaskLattice Relay

TaskLattice Relay is a Project-scoped Kubernetes control plane for operating AI
Agents. It manages model Providers and routing, Instance-bound access and
runtime policies, Agent resources, and observability around
OpenShell sandboxes. OpenShell is the fixed runtime; Hermes is the default
Supervisor implementation, followed by OpenClaw and Deep Agents Code.

TaskLattice is the open-source project name; Relay is this module. User-facing
copy uses **TaskLattice Relay**, while code, package scopes, environment
variables, images, and Kubernetes resources use the shorter **TALI** / `tali`
prefix.

The `v0.1.x` release line is an early preview. The Provider-to-Sandbox path is
implemented end to end. The Traces workbench currently demonstrates the
intended interaction model with fixture data; it is not yet connected to an
OpenTelemetry collector or persistent trace store.

Control Plane runtime settings use a single TOML file; see
[Control Plane configuration](docs/control-configuration.md).

```text
Browser (TanStack Start + shadcn/ui)
                  |
                  | REST + WebSocket
                  v
TaskLattice Relay Control API ---- LiteLLM ---- Provider API
          |        |                    ^
          |        | metadata           | embedding requests
          |        v                    |
          |  shared PostgreSQL <---- Control Worker ---- Docling Serve
          |  (control data, jobs,       durable ingestion   layout/OCR/chunking
          |   LiteLLM, and pgvector)
          v
TaskLattice Relay OpenShell Runner
          |
          | request-scoped Project Runtime Target
          +---- Project Namespace A: OpenShell Gateway ---- Agent Sandbox CR
          |                                              `---- Sandbox Pod + PVC
          `---- Project Namespace B: OpenShell Gateway ---- Agent Sandbox CR
                                                         `---- Sandbox Pod + PVC
```

## Core capabilities

- Project-scoped membership, quotas, configuration, and resource ownership.
- One Kubernetes Namespace and OpenShell Gateway per Project on the pinned
  OpenShell 0.0.106 compatibility path, routed by one central Runner.
- Provider registration, model discovery, LiteLLM-backed Model Routings,
  per-Instance virtual keys, spend attribution, and cost views.
- Direct, many-to-many Instance bindings to reusable Access Policies, with
  independently selected OpenShell Runtime Policies.
- Hermes and OpenClaw Instances with browser UI and terminal access, plus Deep
  Agents Code Instances with native TUI and headless CLI access.
- Agent Garden registration and Agent-to-Agent connections, plus Skills, MCP
  Servers, and built-in or externally managed Vector Databases.
- Project audit logs and a preview Trace workbench for Agent, model, tool, MCP,
  and external-system interactions.

## Install the latest Release

The default installation target is the
[latest published GitHub Release](https://github.com/tasklattice/tasklattice-relay/releases/latest).
Set `VERSION` to that Release version without its leading `v`. The Chart and
all seven first-party images then use that versioned tag; TaskLattice Relay does
not deploy the floating `latest` image tag.

Download the self-contained Chart attached to the Release:

The canonical application namespace is `tali` (displayed as **TALI**). Install
the separate `tasklattice-guard` project into this same namespace when it is
used with Relay. Guard remains independently released and is not bundled in
this repository or Chart.

The published Chart and Helm release are named `tali-relay`. They run in the
product-level `tali` namespace shared with separately installed TALI components.

```sh
VERSION="<latest-release-version>"
curl --fail --location --remote-name \
  "https://github.com/tasklattice/tasklattice-relay/releases/download/v${VERSION}/tali-relay-${VERSION}.tgz"
helm upgrade --install tali-relay "./tali-relay-${VERSION}.tgz" \
  --namespace tali \
  --create-namespace \
  --wait \
  --timeout 30m
```

The same Chart is published to GHCR as an OCI artifact:

```sh
VERSION="<latest-release-version>"
helm upgrade --install tali-relay \
  oci://ghcr.io/tasklattice/charts/tali-relay \
  --version "${VERSION}" \
  --namespace tali \
  --create-namespace \
  --wait \
  --timeout 30m
```

The Chart defaults the Control and OpenShell Services to `LoadBalancer`. On a
cluster that does not provision external load-balancer addresses, add these
overrides to either installation command; without them, Helm `--wait` will time
out:

```sh
helm upgrade --install tali-relay \
  oci://ghcr.io/tasklattice/charts/tali-relay \
  --version "${VERSION}" \
  --namespace tali \
  --create-namespace \
  --set control.service.type=ClusterIP \
  --set openshell.service.type=ClusterIP \
  --wait \
  --timeout 30m
```

Requirements:

- Kubernetes 1.29 or newer.
- Helm and `kubectl`.
- Access to GHCR and the public upstream registries.
- A default `ReadWriteOnce` StorageClass.
- Permission to create namespaces, CRDs, ClusterRoles, and ClusterRoleBindings.
  If the Agent Sandbox controller is managed separately, install it first and
  set `agentSandbox.enabled=false`.
- Credentials or an endpoint for at least one supported model Provider.
- At least 4 CPU and 8 GiB memory for a practical single-Instance deployment.

Verify the installation:

```sh
kubectl -n tali rollout status deployment/tali-relay-control --timeout=300s
kubectl -n tali rollout status deployment/tali-relay-control-worker --timeout=300s
kubectl -n tali rollout status deployment/tali-relay-runner --timeout=300s
kubectl -n tali rollout status deployment/tali-relay-litellm --timeout=300s
kubectl -n tali rollout status deployment/tali-relay-docling --timeout=1800s
kubectl -n tali rollout status statefulset/tali-relay-postgresql --timeout=300s
kubectl -n tali rollout status statefulset/tali-relay-openshell --timeout=300s
kubectl -n tali rollout status deployment/agent-sandbox-controller --timeout=300s
kubectl -n tali get pods,services,pvc
```

## Images and versions

TaskLattice Relay publishes seven first-party images. A packaged Release Chart sets
its `appVersion` to the Release version, and every empty first-party image tag
resolves to that exact value.

| Component                | Released image or version                                       | Purpose                                            |
| ------------------------ | --------------------------------------------------------------- | -------------------------------------------------- |
| TaskLattice Relay control      | `ghcr.io/tasklattice/tali-control:<release>`                   | UI, REST/WebSocket API, and PostgreSQL control data |
| Runtime runner           | `ghcr.io/tasklattice/tali-openshell-runner:<release>`          | OpenShell sandbox lifecycle and terminal relay     |
| LiteLLM                  | `ghcr.io/tasklattice/tali-litellm:<release>`                   | Model gateway, virtual keys, and spend attribution |
| Demo test runtime        | `ghcr.io/tasklattice/demo-test:<release>`                       | Multi-mode MCP and managed A2A example runtime      |
| OpenClaw sandbox         | `ghcr.io/tasklattice/tali-nemoclaw-sandbox:<release>`          | OpenClaw Agent sandbox                             |
| Hermes sandbox           | `ghcr.io/tasklattice/tali-nemoclaw-hermes-sandbox:<release>`   | Default Supervisor sandbox                         |
| Deep Agents sandbox      | `ghcr.io/tasklattice/tali-nemoclaw-deepagents-sandbox:<release>` | Deep Agents Code terminal sandbox                |
| PostgreSQL + pgvector    | `pgvector/pgvector:0.8.6-pg17`                                  | Control data, LiteLLM data, and knowledge vectors  |
| Docling Serve            | `ghcr.io/docling-project/docling-serve-cpu:v1.29.0`              | Layout-aware parsing, table extraction, and OCR    |
| OpenShell gateway        | `ghcr.io/nvidia/openshell/gateway:0.0.106`                      | Policy enforcement, audit, exec, and HTTP routing  |
| OpenShell supervisor     | `ghcr.io/nvidia/openshell/supervisor:0.0.106`                   | Supervisor injected into Agent sandboxes           |
| Agent Sandbox controller | `registry.k8s.io/agent-sandbox/agent-sandbox-controller:v1.0.2` | Sandbox CR, Pod, and workspace PVC lifecycle       |

Agent Sandbox v1.0.2 supports an optional bundled controller or an existing
cluster controller selected with `agentSandbox.enabled`. See the
[upgrade and deployment guide](docs/agent-sandbox-v1.0.2.md).

OpenShell's Chart is a Worker build asset, separate from Relay's Helm dependencies.
The shared Control/Worker image build runs `npm run helm:package:worker` and bundles
the patched chart at `/opt/tali/helm/openshell.tgz`. Deploying Relay or the standalone
Agent Sandbox controller does not download or patch OpenShell.

The OpenShell supervisor and selected Agent image are pulled when an Instance
creates its Sandbox rather than running as permanent control-plane Pods.
The release workflow selects upstream dependencies by the tags declared at the
top of `.github/workflows/release.yml`. Each build uses the content currently
published under those tags. Release builds refresh upstream image tags and the
OpenShell CLI download instead of reusing those inputs from cache; rerunning a
release rebuilds and replaces the TaskLattice artifacts for that release.
The tag-triggered GitHub Actions workflow is the only supported Release build
and publication entry point; local commands produce `:dev` images and a
development Chart only.

## Access

On a cluster with `LoadBalancer` support, open the external address of the
`tali-relay-control` Service on port 38080. When using the `ClusterIP` overrides,
forward the Control Service and open `http://127.0.0.1:18080`:

```sh
kubectl -n tali port-forward service/tali-relay-control 18080:38080
```

Keep this second forward running when validating a Sandbox Agent UI through
OpenShell:

```sh
kubectl -n tali port-forward service/tali-relay-openshell 8080:8080
```

The checked-in Chart defaults are suitable only for a trusted cluster: local
login is `admin / admin`, and OpenShell permits unauthenticated plaintext
gateway clients. Before shared or internet-facing use, override every
`secrets.*` value and configure authenticated ingress plus OpenShell TLS/OIDC.
For an end-to-end SSO test environment, the Chart can deploy an ephemeral,
preconfigured Keycloak. Do not enable `keycloak.enabled` alone:
`keycloak.publicUrl` must be reachable from both the browser and the Control
Pod, and `control.publicUrls` must include every browser-visible TaskLattice Relay origin
used for the OIDC callback.
See the [Chart documentation](charts/tali-relay/README.md) for existing
Secrets, image pull Secrets, embedded Keycloak examples, and external runtime
settings.

## First Instance

After signing in:

1. In Project settings, connect a Provider and register at least one validated
   text-generation model.
2. Create a Model Routing from the registered models and wait for it to reach
   `READY`. The first ready Routing becomes the Project default automatically.
3. Review the automatically configured `Default` Access Policy. It is Active
   and intentionally has no MCP allow rules, so a new Project starts from a
   deny-all baseline. Add narrower policies when the Instance needs tools.
4. Create an Instance, choose Hermes, OpenClaw, or Deep Agents Code, select an Agent Role and one
   or more Active Access Policies, and keep the built-in Unrestricted Runtime
   Policy for the first validation run. The Instance uses the Project's READY
   default Model Routing.
5. Wait for the Instance to reach `READY`. Hermes and OpenClaw publish their
   Agent UI and terminal; Deep Agents opens its `dcode` TUI in the terminal and
   also supports `dcode -n` for headless use.

A successful Instance reaches `READY` and enables its platform-supported
interaction surface. Deep Agents Code is intentionally terminal-only and does
not publish a separate Web UI endpoint. Each Instance receives an isolated LiteLLM virtual key and an
OpenShell Sandbox with its own workspace PVC.

## Persistence and uninstall

The control plane and LiteLLM share one PostgreSQL database instance. Control
data is isolated in the compatibility `tasklattice` schema while LiteLLM retains its `public`
schema. OpenShell gateway data and Agent workspaces use their own PVCs.
Restarting Pods does not reset that state. A control init container applies
Prisma SQL migrations before each rollout.

Delete active Instances and back up required data before uninstalling:

```sh
kubectl -n tali get sandboxes,pvc
helm uninstall tali --namespace tali
```

StatefulSet claim-template PVCs, dynamically created workspace PVCs, Sandbox
resources, and CRDs may remain after Helm uninstall. Review them explicitly
before removal.

Additional design documentation:

- [Image release and Helm publishing](docs/image-release-and-helm.md)
- [OpenShell Kubernetes runtime](docs/openshell-kubernetes-runtime.md)
- [Project Runtime Namespaces](docs/project-runtime-namespaces.md)
- [Control Worker](docs/control-worker.md)
- [Agent Garden architecture](docs/agent-garden-architecture.md)
- [Model and Routing](docs/model-routing.md)
- [MVP core flow](docs/mvp-core-flow.md)
- [Contributing and local development](CONTRIBUTING.md)

## License

TaskLattice Relay is licensed under the [Apache License 2.0](LICENSE). It permits
commercial use, modification, and distribution subject to the terms of the
license.
