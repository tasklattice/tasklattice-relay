# Image Release and Helm Deployment

## Image Inventory

TaskLattice Relay publishes **seven first-party images**:

| Image | Build entry point | Purpose | Published architectures |
| --- | --- | --- | --- |
| `tali-control` | `infra/docker/Dockerfile`, target `control` | Web UI, REST/WebSocket API, and PostgreSQL control data | amd64, arm64 |
| `tali-openshell-runner` | `infra/docker/Dockerfile`, target `runner` | Invokes OpenShell to create, observe, connect to, and destroy Sandboxes | amd64, arm64 |
| `demo-test` | `infra/docker/Dockerfile`, target `demo-test` | Multi-mode MCP and managed A2A example runtime | amd64, arm64 |
| `tali-nemoclaw-sandbox` | `scripts/build-nemoclaw-sandbox.sh` (`openclaw`) + `Dockerfile.nemoclaw-openclaw` | Dynamic Sandbox for the OpenClaw Agent | amd64, arm64 |
| `tali-nemoclaw-hermes-sandbox` | The same script (`hermes`) + `Dockerfile.nemoclaw-hermes` | Dynamic Sandbox for the Hermes Agent | amd64, arm64 |
| `tali-nemoclaw-deepagents-sandbox` | The same script (`deepagents`) + `Dockerfile.nemoclaw-deepagents` | Dynamic terminal Sandbox for Deep Agents Code | amd64, arm64 |

A complete deployment also pulls **four version-tagged third-party images**: PostgreSQL,
the OpenShell gateway, the OpenShell supervisor, and the Agent Sandbox
controller. A deployment using the optional example MCP server and running at
least one OpenClaw, one Hermes, and one Deep Agents Code Instance therefore uses
**eleven unique images**. The three Agent images and the supervisor do not create
long-lived Pods immediately after installation and before an Agent Instance is
created, but the runner already retains their released image references.

## Build Relationships

`control` and `runner` share the Node 22 dependency and TypeScript compilation
stages. The runner also downloads the selected OpenShell CLI release.

The LiteLLM gateway image `ghcr.io/tasklattice/tali-litellm` is not built by Relay.
It is published by [tasklattice-litellm-guard](https://github.com/tasklattice/tasklattice-litellm-guard),
which owns the TaskLattice Guard Guardrail Provider, under tags
`<litellm-version>-guard.<n>`. The chart pins `images.litellm.tag` (currently
`1.87.0-guard.3`); Relay releases neither rebuild nor re-tag it. To adopt a new Provider
or LiteLLM release, change that pin and `scripts/deploy-local.sh` together.

All three Agent images are built from a selected NemoClaw release tag and then passed through
their respective thin, repository-owned wrapper layers to produce the final
published images. OpenClaw applies the repository's no-proxy patch before the
upstream build, while `Dockerfile.nemoclaw-openclaw` provides the customization
boundary for future TaskLattice Relay changes. If the upstream Hermes image cannot be
pulled anonymously, the Hermes build first creates its selected-tag base fallback and
then uses `Dockerfile.nemoclaw-hermes` to align the UID/GID with OpenShell's
requirements and add the configuration bootstrap. Deep Agents Code retains the
upstream `dcode` TUI/headless runtime and adds a Relay-owned image boundary; its
runtime configuration is regenerated for the Instance's LiteLLM route before
`nemoclaw-start` begins. The release workflow builds all three pipelines
independently for amd64 and arm64, then combines them into
multi-architecture manifests.

`npm run images:build:dev` builds all seven first-party images from the current
checkout and selected upstream sources, then stores the results only in the
local Docker daemon under `:dev`. It never pulls and retags a published
TaskLattice image. Release builds use Buildx registry output instead: the
selected upstream stage is pushed under an
architecture-specific `build-upstream-<release>-<architecture>` tag in the final
image repository, and the wrapper stage is then pushed directly to its release
tag. This avoids importing two complete Agent images into the hosted runner's
local Docker layer store.

Every Agent build pipeline follows the same layering convention:

```text
selected upstream source tag + selected base image tag
  -> tali-nemoclaw-<agent>-upstream:<release> (build-time only)
  -> infra/docker/Dockerfile.nemoclaw-<agent>
  -> ghcr.io/<owner>/tali-nemoclaw-<agent>-sandbox:<release>
```

The upstream Dockerfiles are not copied into this repository, so each build uses
the content currently published under the selected NemoClaw tag. TaskLattice Relay-owned
startup scripts, configuration bootstraps, identity adaptations, and runtime
extensions belong only in the wrapper layers. New Agent runtimes should follow
the same convention with a dedicated wrapper Dockerfile instead of accumulating
platform-specific customization in `build-nemoclaw-sandbox.sh`. OpenClaw retains
the historical published name `tali-nemoclaw-sandbox` for compatibility
with existing deployments, while its internal upstream tag explicitly includes
`openclaw`.

## GitHub Actions Release

`.github/workflows/release.yml` responds only to semantic version tags, for
example:

```bash
git tag v0.3.0
git push origin v0.3.0
```

This tag-triggered GitHub Actions workflow is the only supported entry point for
building or publishing Release images and charts. Local npm commands build
`:dev` images and a development chart only; the release-output paths reject
non-GitHub-Actions, non-release-workflow, and non-semantic-tag environments.

The workflow runs tests, type checking, and Helm rendering before building the
seven GHCR images in parallel. Each image publishes `X.Y.Z`. Stable releases also update `latest`, while
prerelease tags such as `v0.3.0-rc.1` do not. After a successful build, the
workflow:

1. Publishes `oci://ghcr.io/<owner>/charts/tali-relay:X.Y.Z`.
2. Creates a GitHub Release.
3. Attaches the self-contained `tali-X.Y.Z.tgz` package to the Release.
4. Triggers a fresh Kind smoke test that downloads the attached package, pulls
   the `X.Y.Z` images, installs the packaged Chart, and waits for healthy Pods.

Upstream image references are refreshed on every Release build, and the
OpenShell CLI download stage bypasses the build cache. Rerunning the workflow
therefore resolves the current content of the declared upstream tags and
replaces the images and release asset published under the same Relay version.

GHCR packages must be public unless the target cluster is configured with a
pull secret. After publishing packages from the repository for the first time,
verify in the GitHub package settings that the visibility of all seven image
packages and the chart package matches the deployment environment.

## Deploy from a GitHub Release

The Chart/package and Helm release name is `tali-relay`. The examples deploy it
into the product-level `tali` namespace.

```bash
VERSION="<release-version>"
curl -fLO "https://github.com/tasklattice/tasklattice-relay/releases/download/v${VERSION}/tali-relay-${VERSION}.tgz"
helm upgrade --install tali-relay "./tali-relay-${VERSION}.tgz" \
  --namespace tali \
  --create-namespace \
  --wait \
  --timeout 30m
```

The chart can also be installed directly from GHCR OCI:

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

The default values match the current local validation path: control and
OpenShell use `LoadBalancer`, local sign-in uses `admin/password`, and OpenShell
uses plaintext communication inside the cluster while accepting unauthenticated
clients. These defaults allow a trusted local cluster to start directly, but
they are not suitable for a shared or public environment. At a minimum,
production deployments must replace every `secrets.*` value through a private
values file and configure TLS/OIDC for OpenShell and the ingress. If the Agent
Sandbox controller is already installed in the cluster, set
`agentSandbox.enabled=false` to avoid managing the cluster-scoped CRDs and
controller more than once.

Private GHCR images require a pull secret that is passed to both the TaskLattice Relay
Pods and dynamic Sandboxes:

```yaml
global:
  imagePullSecrets:
    - name: ghcr-pull
openshell:
  server:
    sandboxImagePullSecrets:
      - name: ghcr-pull
```
