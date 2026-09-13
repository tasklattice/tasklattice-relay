# Contributing

Thank you for contributing to TaskLattice Relay. This guide covers source builds,
tests, local Kubernetes deployment, and the checks expected before submitting
a change. Released deployments should use the latest published Release Chart
and its exact immutable Release version as described in the root README.

## Before submitting a change

Run the checks relevant to your change. The complete repository validation is:

```sh
npm test
npm run typecheck
npm run build
helm lint charts/tali-relay
helm lint charts/tali-relay --values charts/tali-relay/values-dev.yaml
```

Keep generated credentials, `.env`, local databases, and provider keys out of
Git. Update documentation and tests together with behavior changes.

## Image convention

Local development uses the same canonical repositories as a Release and only
changes the tag to the permanent `dev` value:

```text
ghcr.io/tasklattice/tali-control:dev
ghcr.io/tasklattice/tali-openshell-runner:dev
ghcr.io/tasklattice/tali-litellm:dev
ghcr.io/tasklattice/demo-test:dev
ghcr.io/tasklattice/tali-nemoclaw-sandbox:dev
ghcr.io/tasklattice/tali-nemoclaw-hermes-sandbox:dev
ghcr.io/tasklattice/tali-nemoclaw-deepagents-sandbox:dev
```

These images are built into the local Docker store. The Release workflow does
not publish the `dev` tag; release tags publish the same seven repositories.

## Prerequisites

- Git and outbound access to GitHub, Docker Hub, GHCR, and npm.
- Node.js 22 or newer and npm.
- Docker with BuildKit support.
- Kubernetes 1.29 or newer with a default `ReadWriteOnce` StorageClass.
- Helm and `kubectl`.
- Kind CLI when using a Kind cluster.
- At least 4 CPU and 8 GiB memory for one Agent Sandbox.

Verify the toolchain and target cluster:

```sh
node --version
npm --version
docker version
kubectl version --client
helm version --short
kubectl config current-context
kubectl get nodes
```

The deploy script uses `KUBE_CONTEXT` when supplied, then the current kubectl
context, and finally an available `orbstack` context.

## Install and validate the source tree

```sh
git clone git@github.com:tasklattice/tasklattice-relay.git
cd TaskLattice Relay
npm ci
npm test
npm run typecheck
```

The Kubernetes deployment does not read `.env`. Create it only for host-mode
development:

```sh
cp .env.example .env
```

Never commit `.env`.

## Build the local images

Build all seven first-party development images from the current checkout and the
selected upstream sources. Every final image is written only to the local Docker
store with a `:dev` tag:

```sh
npm run images:build:dev
```

The Agent Sandbox commands do not pull or retag a published TaskLattice image.
They clone the pinned NVIDIA NemoClaw revision, build the selected Agent source,
and pass it through the TaskLattice Relay-owned wrapper Dockerfile. Hermes and
Deep Agents Code build their pinned base locally when the upstream GHCR base is
unavailable. Third-party base images and build dependencies may still be pulled.

Local development commands never build or publish release tags. The only
supported Release entry point is the tag-triggered GitHub Actions workflow in
`.github/workflows/release.yml`.

Confirm the resulting images:

```sh
docker image inspect ghcr.io/tasklattice/tali-control:dev
docker image inspect ghcr.io/tasklattice/tali-openshell-runner:dev
docker image inspect ghcr.io/tasklattice/tali-litellm:dev
docker image inspect ghcr.io/tasklattice/tali-nemoclaw-sandbox:dev
docker image inspect ghcr.io/tasklattice/tali-nemoclaw-hermes-sandbox:dev
docker image inspect ghcr.io/tasklattice/tali-nemoclaw-deepagents-sandbox:dev
docker image inspect ghcr.io/tasklattice/demo-test:dev
```

Individual build commands are available for shorter loops:

```sh
npm run images:build:dev:control
npm run images:build:dev:runner
npm run images:build:dev:litellm
npm run images:build:dev:demo-test
npm run images:build:dev:sandbox:openclaw
npm run images:build:dev:sandbox:hermes
npm run images:build:dev:sandbox:deepagents
```

## Deploy with Helm

The development values install TaskLattice Relay, LiteLLM, PostgreSQL, OpenShell, and
the Agent Sandbox controller as one Helm release:

```sh
KUBE_CONTEXT=orbstack npm run helm:deploy:dev
```

The deploy script:

- verifies that all five `:dev` images exist locally;
- loads them into Kind when the context name starts with `kind-`;
- installs `charts/tali-relay` with `values-dev.yaml`;
- changes `global.rolloutRevision` so rebuilt mutable images create new Pods;
- waits for the complete release to become ready.

Verify the workloads:

```sh
kubectl -n tali-sandboxes rollout status deployment/tali-relay-control --timeout=300s
kubectl -n tali-sandboxes rollout status deployment/tali-relay-runner --timeout=300s
kubectl -n tali-sandboxes rollout status deployment/tali-relay-litellm --timeout=300s
kubectl -n tali-sandboxes rollout status statefulset/tali-relay-postgresql --timeout=300s
kubectl -n tali-sandboxes rollout status statefulset/tali-relay-openshell --timeout=300s
kubectl -n tali-sandboxes rollout status deployment/agent-sandbox-controller --timeout=300s
```

On OrbStack, open `http://localhost:38080` and sign in with `admin / admin`. The
LiteLLM development UI uses `admin / tali-local-admin`.

The development values disable OpenShell TLS and allow unauthenticated gateway
clients. Use them only on a trusted local cluster.

## End-to-end runtime validation

After registering a Provider, creating a ready default Model Routing, and
reviewing the automatically configured deny-all `Default` Access Policy,
validate the runtime flow through the Control console:

1. Create an Instance with one or more Active Access Policies and confirm it
   reaches `READY`.
2. OpenShell publishes the Agent UI and its routed endpoint returns HTTP 200.
3. The terminal connects to the same-name Sandbox Pod.
4. `/etc/hostname` matches the Instance `sandboxName`.
5. The pinned Agent runtime and `/usr/local/bin/nemoclaw-start` are available.
6. The in-sandbox gateway health endpoint responds.
7. Deleting the Instance removes its API resource, HTTP endpoint, and runtime.

The legacy `npm run validate:core` helper has not yet been migrated to the
current Project-scoped Instance and Access Policy contracts. Do not use it as
a release gate until that migration is complete.

Useful runtime inspection commands:

```sh
kubectl -n tali-sandboxes get sandboxes,pods,pvc
kubectl -n tali-sandboxes logs deployment/tali-relay-runner --tail=200
kubectl -n tali-sandboxes logs statefulset/tali-relay-openshell --tail=200
```

## Host-only API and UI development

Use the fixture runner when changing API or UI contracts without an Agent Pod.

Terminal 1:

```sh
NEMOCLAW_RUNNER_MODE=fixture npm run dev:runner
```

Terminal 2:

```sh
docker run --rm --name tali-dev-postgres \
  -e POSTGRES_PASSWORD=tali \
  -e POSTGRES_DB=tali \
  -p 5432:5432 pgvector/pgvector:0.8.6-pg17
```

Terminal 3:

```sh
cp control.example.toml control.toml
# Set database.url to:
# postgresql://postgres:tali@127.0.0.1:5432/tali
export TALI_CONFIG="$PWD/control.toml"
npm run db:migrate --workspace @tali/control
PORT=18080 npm run dev:control
```

The control console is then available at `http://127.0.0.1:18080`.

## Rebuild and roll out

Rebuild the affected image and rerun the Helm deployment:

```sh
npm run images:build:dev:control
KUBE_CONTEXT=orbstack npm run helm:deploy:dev
```

The same pattern applies to runner and LiteLLM changes. Rebuilding an Agent
sandbox image affects newly created Sandboxes; recreate an existing development
Instance when testing a new OpenClaw, Hermes, or Deep Agents Code image.

## Kind smoke test

The smoke test installs the Chart into an existing Kind cluster with the
current repository's published `latest` images. It does not build or load local
images, but it does wait for the Kubernetes workloads to become ready:

```sh
kind create cluster --name tali-ci
bash scripts/helm-kind-smoke.sh
```

## Cleanup

Delete active Instances before removing the local release:

```sh
KUBE_CONTEXT=orbstack npm run helm:delete:dev
```

Review retained StatefulSet PVCs, Sandbox resources, CRDs, and workspace PVCs
before removing any persistent local data.

## Troubleshooting

### Kubernetes context is unavailable

Set an explicit context and ensure its API is running:

```sh
KUBE_CONTEXT=orbstack npm run helm:deploy:dev
```

### A `dev` image cannot be pulled

Confirm the exact image exists in Docker. A non-shared Kubernetes runtime must
load the same fully qualified image name into every node:

```sh
docker image inspect ghcr.io/tasklattice/tali-nemoclaw-sandbox:dev
docker image inspect ghcr.io/tasklattice/tali-nemoclaw-hermes-sandbox:dev
```

The deploy script loads all five images automatically for Kind. Other local
cluster implementations must provide an equivalent image-loading mechanism.

### The UI still shows an old build

Rerun `npm run helm:deploy:dev`. The command changes the rollout revision on
the control, runner, and LiteLLM Pod templates even though their image tag
remains `dev`.

### An Agent Sandbox fails

Inspect the Sandbox, runner, and OpenShell gateway:

```sh
kubectl -n tali-sandboxes get sandboxes,pods,pvc
kubectl -n tali-sandboxes logs deployment/tali-relay-runner --tail=200
kubectl -n tali-sandboxes logs statefulset/tali-relay-openshell --tail=200
```
