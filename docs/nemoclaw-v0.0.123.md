# NemoClaw v0.0.123 and Native Memory

Relay's Sandbox builds, release workflow, Runner version label, and Helm defaults
target NemoClaw **v0.0.123**. OpenShell stays at **0.0.106** and Agent Sandbox
Controller at **v1.0.2**. The three Sandbox images are built from the same upstream
NemoClaw tag:

| Agent | Embedded runtime | Native Memory |
| --- | --- | --- |
| Hermes | 0.20.6 (previously 0.19.0) | `.hermes/memories/MEMORY.md` and `USER.md` |
| OpenClaw | 2026.7.1 | `.openclaw/workspace/MEMORY.md` and `memory/` |
| Deep Agents Code | 0.1.55 | `.deepagents/agent/AGENTS.md` |

Paths are relative to `/sandbox`, the Instance's persistent workspace. Native
Memory survives Pod replacement while that workspace is retained. Deleting the
Instance deletes its workspace and Native Memory; this is not a shared Memory
bank and cannot be reattached to another Instance.

## Creation behavior

The creation form defaults to Native Memory for all three Agents. No Embedding
deployment, Hindsight bank, or external memory provider is needed. Embedding
discovery being pending or failing does not disable Native creation.

When Embedding is available, OpenClaw and Hermes can explicitly select a new or
existing Durable Memory. Deep Agents uses Native Memory. API clients can select
Native Memory explicitly with:

```json
{"memory": {"mode": "native", "citations": "auto"}}
```

API requests that omit the memory selection retain automatic Durable Memory for
OpenClaw/Hermes when it is available; without it they fall back to Native Memory.
Deep Agents defaults to Native Memory in either case. Explicit vector database
or Durable Memory attachment still requires Embedding.

## Compatibility fixes

- Hermes Native Memory enables both built-in text stores and clears the external
  `memory.provider`. An empty provider is Hermes' native selection.
- The Dashboard seeder accepts native and `tali_relay` memory, while still
  rejecting unknown providers and malformed flags. Previously it rejected native
  memory and repeatedly prevented Dashboard readiness.
- Without optional Relay registries, the Dashboard uses Hermes' default
  `hermes-cli` toolset. A2A and vector database setup are not startup prerequisites.
- Hermes' upstream image has 124 filesystem layers. The existing consolidated
  overlay keeps the final image at 126 layers for local containerd compatibility.
- The obsolete Deep Agents login-profile patch was removed: its upstream target
  was removed with Shields in NemoClaw v0.0.120. The Provider v2 inference patch
  remains in place.

## Local acceptance

### Source cache for image builds

The three `images:build:dev:sandbox:*` commands share pristine NemoClaw sources
under `${TMPDIR:-/tmp}/tali-nemoclaw-cache`. The cache is keyed by repository and
`NEMOCLAW_VERSION` (a release tag or commit), and a cache hit requires no Git network
access. Each build copies the source into a disposable directory before applying
platform patches. Changing the version creates a separate cache entry.

The initial download uses a shallow fetch with complete blobs over HTTPS, bypassing
broad local GitHub-to-SSH URL rewrites for this fetch only. Failed downloads retry
up to three times and never publish an incomplete cache. Docker image pulls and
dependencies installed inside Docker builds still need network access.

Set `NEMOCLAW_SOURCE_CACHE_DIR` to retain sources outside the OS temporary directory
or to use a fresh cache. To refresh a moved tag, remove its cache entry (the build
prints the path). Release tags are otherwise treated as immutable.

After a failure in the Deep Agents build, resume just that image:

```sh
npm run images:build:dev:sandbox:deepagents
```

### Runtime checks

Build the Runner and the three images using the repository's `images:build:dev:*`
commands. Install the independent Controller in a fresh local test cluster with
`npm run helm:deploy:agent-sandbox`, then run:

```sh
KUBE_CONTEXT=orbstack npm run test:e2e:native-memory
```

The script reuses the cluster Controller, creates a temporary namespace containing
OpenShell, a real Runner, and a synthetic chat endpoint that rejects Embedding
requests. It creates each Agent through the Runner API, checks runtime readiness,
writes native memory, exercises chat, replaces the Pod through stop/start,
verifies the same PVC and retained memory, and checks deletion cleanup. The
stop/start check proves workspace persistence, not automatic application recovery.
Successful runs delete the temporary namespace. `TALI_KEEP_FAILED_TEST=1` retains
failed test resources for diagnosis.

This validates the local arm64 builds and runtime integration with a model
fixture. It does not measure real-model answer quality, verify amd64 images, or
upgrade UAT Instances.

### Results — 2026-09-13

- All three images and the Runner built successfully on local arm64.
- Runner: 69 tests passed. Control creation and memory selection: 45 tests passed.
- Control TypeScript check, Helm resource validation, and disconnected-image
  rendering passed.
- OrbStack Kubernetes acceptance: all three Agents reached READY, completed chat,
  retained Native Memory on the same PVC after Pod replacement, and deleted
  successfully. The fixture recorded 4 completion requests and 0 Embedding requests.
- OpenClaw's chat used its embedded fallback after the fresh CLI device requested
  a Gateway scope upgrade. Gateway health passed; an approved WebSocket chat
  session was not verified by this run.
- Temporary test Gateways, Runner, model fixture, Sandboxes, and PVCs were cleaned
  up. The independent v1.0.2 Controller remains available locally.

## Upstream references

- [NemoClaw v0.0.123 release](https://github.com/NVIDIA/NemoClaw/releases/tag/v0.0.123)
- [v0.0.123 changelog](https://github.com/NVIDIA/NemoClaw/blob/v0.0.123/docs/changelog/2026-09-10.mdx)

The release expands managed Hermes/OpenClaw configuration export and improves
lifecycle and inference diagnostics. Its experimental external-component
onboarding is for a Linux Docker-driver gateway; it is not automatically enabled
by Relay's Kubernetes integration.
