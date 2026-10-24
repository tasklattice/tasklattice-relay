# NemoClaw v0.0.138 upgrade

## Version contract

Relay pins NemoClaw **v0.0.138** (commit
`7312e7f49e3e96125b8237968e2552a48e2cb1b6`) and OpenShell **0.0.116**.
NemoClaw's installer sets both its minimum and maximum OpenShell version to
0.0.116. Keep the CLI, Gateway, supervisor and packaged Worker chart aligned.
Agent Sandbox Controller remains **v1.0.2** with the served v1beta1 API.

| Component | Previous | Target |
| --- | --- | --- |
| NemoClaw | v0.0.123 | v0.0.138 |
| OpenShell | 0.0.106 | 0.0.116 |
| OpenClaw | 2026.7.1 | 2026.9.2 |
| Hermes | 0.20.6 | 0.21.3 (v2026.9.14 source) |
| Deep Agents Code | 0.1.55 | 0.1.71 |

## Upgrade sequence and gates

1. Save current image tags, Helm values, Sandbox definitions and PVC identities.
   Back up persistent state before running a migration; keep backups private.
2. Update version defaults, CI release builds and the OpenShell chart patch.
   Render with the existing Sandbox API; retain the live chart's CRD preflight.
3. Build the three Agent images from the same pristine NemoClaw tag. Build
   Control/Worker with the new chart and Runner with the matching OpenShell CLI.
   Require non-root OCI users, upstream integrity checks, dependency checks and
   the Relay integration probes to pass before deployment.
4. Upgrade the existing local `tali-relay` release on OrbStack. Reconcile Project
   Gateways, then replace Agent Pods while retaining each Instance's PVC.
   Local access remains `http://localhost:38080`; no development CA is needed.
5. Verify Gateway/supervisor/CLI versions, actual Pod image identities, readiness
   and inference for OpenClaw, Hermes and Deep Agents. Verify native UI at
   `/<projectId>/<instanceId>/ui/` for Hermes and OpenClaw and the terminal for
   Deep Agents. Check old sessions and Native Memory survive, and Hermes with
   Memory enabled still uses its bundled Hindsight provider for retain/recall.
6. On failure, stop promotion to other Instances. Restore previous image tags
   and Helm configuration. If state migrations have run, restore their matching
   state backup before downgrading; replacing binaries alone is insufficient.

## Relay adaptations

Hermes now shares `/sandbox/.hermes` between the native Dashboard, CLI and
Gateway. Remove the separate Dashboard seeder patches; the Relay bootstrap sets
inference, tools and memory once in the native configuration. Upstream owns
migration from old `dashboard-home` state. Native selects the builtin text
stores; Memory enabled selects the bundled `hindsight` provider with the scoped
Project Runtime Bridge. Provider keys remain OpenShell references.

Keep the Hermes image account aligned with the Kubernetes workload UID/GID and
restore `USER sandbox` after installing the Relay overlay. OpenShell 0.0.116
requires a non-root OCI default. Do not relax filesystem ownership checks.

OpenShell 0.0.116 rejects file uploads combined with a canonical main command.
Runner now packages the non-secret bootstrap and initial instructions into
bounded arguments to that command. The supervisor owns the long-running process;
instructions are initialized once and survive subsequent starts. Provider
credentials are still injected at runtime as references. A successful detached
CLI exit is followed by the application health check.

Hermes also changed its configuration anchor to two hash lines and removed the
old MCP digest helper. Validate the existing anchor before rewriting it; accept
the previous clean three-line anchor only for this migration. Keep the anchor
and configuration owned by the sandbox user and non-writable by its group.
The image build exercises this against the actual upstream configuration.

Before the native Hermes migration, archive only recognized generated Dashboard
shadows. Preserve memories and populated session databases. Unknown conflicts,
symlinks, unexpected owners, and two populated conflicting databases stop the
migration. An empty SQLite database may be archived after an integrity check;
FTS shadow metadata alone does not count as user state.

OpenClaw no longer assigns the old sandbox-interface Gateway URL. Remove the
patch for that obsolete NO_PROXY assignment. Retain the locked mcporter
security overlay after reviewing the v0.0.138 input hashes; do not skip audits.
Before starting an existing OpenClaw workspace, run its official
`openclaw doctor --fix --non-interactive` migration. Its SQLite temporary
directory must be owned by the sandbox user and mode 0700, including after
Kubernetes fsGroup reconciliation. Never replace a populated database with an
empty one to make startup pass.

Only Hermes receives the `X-Forwarded-Prefix` routing hint. OpenClaw 2026.9
treats every `X-Forwarded-*` header as a client attribution claim; Relay removes
browser-supplied forwarding headers and uses its authenticated backend channel.
Its native message subscription excludes approval events, which now require a
paired device. Normal message streaming remains enabled; Relay does not create
a browser device identity or widen its backend scopes.

Deep Agents now has an upstream credential selector. Preserve it outside Relay
and adapt the existing Provider v2 branch to use the attached endpoint and
credential reference. Retain bounded file reads, ownership/mode checks,
symlink rejection and endpoint validation.

## Existing-instance recovery

Use the OpenShell lifecycle API for normal stop/start, retaining the existing
workspace. Patch the workload to the new supervisor and canonical command before
starting it. Keep the same Agent image repository and use the rebuilt `dev`
image only for this local deployment.

OpenShell 0.0.116 treats `Error` as terminal, even if an underlying Pod has
recovered. Stop/start alone cannot recover such a runtime. The local upgrade
used this guarded recovery for two affected instances:

1. Back up the OpenShell policy, Sandbox specification, workspace and PVC UID.
   Verify the Project Namespace is active and belongs to the intended Project.
2. Give the PVC a temporary, live Namespace owner before removing the failed
   Sandbox runtime. Verify it is Bound and has no deletion timestamp.
3. Delete only the OpenShell runtime through its CLI. Keep the Relay Instance
   record and existing Providers. Wait for the old Sandbox and Pod to disappear,
   then assert the original PVC UID still exists and is Bound.
4. Create the same runtime name and workspace with the new canonical command,
   image and original business policy. Reattach existing Providers; let
   OpenShell compose their policy rules rather than copying generated rules.
5. Wait for readiness and compare PVC UID again. Restore the PVC's controller
   owner to the new Sandbox, and the Sandbox's owner to the Project Namespace.
   Remove the temporary PVC Namespace owner so normal future Instance deletion
   retains its original cleanup semantics.

Runner now re-observes failed OpenShell runtimes. Control may refresh a failed
Instance that still has its provisioned model identity, so recovery is visible
without recreating the product resource. A creation that never produced a
runtime keeps its original failure diagnostics. Read-only observations do not
invoke Worker-only Kubernetes ownership reconciliation.

## Rollback

Keep the pre-upgrade PostgreSQL dump, five original workspace archives, Helm
values, Sandbox definitions and PVC UID inventory private. The local copies
are in `/private/tmp/relay-upgrade-138` with restricted permissions. Previous
Control, Runner, OpenClaw and Hermes images have local `before-138` tags.

Quiesce affected instances before restoring state. Restore their matching
workspace backups and the previous OpenShell/Agent/Control versions together;
OpenClaw's SQLite and Hermes' shared-home migrations are not a binary-only
downgrade. If the control database also needs rollback, stop writers before
restoring its backup. Compare original PVC UIDs and rerun inference and memory
acceptance before reopening access. Do not delete Project resources to roll
back an Agent runtime.

## Validation record

Local deployment: OrbStack, namespace `tali`, existing `proj1` Project, origin
`http://localhost:38080`. All three Project Gateways reconciled to 0.0.116.
The Runner CLI and all seven Agent supervisors were verified as 0.0.116.
All five original workspace PVC UIDs were retained. Temporary diagnostic
containers were removed.

| Image repository (`ghcr.io/tasklattice/`, tag `dev`) | Image ID (SHA-256) |
| --- | --- |
| `tali-nemoclaw-sandbox` | `9dba2dc7db53717261d6ae1998fa2f41f09e1b8415aea6d85ab64f4718ca1bce` |
| `tali-nemoclaw-hermes-sandbox` | `48bc366d3f1673747dbc1916eaa3fc9f0cc37555c994214c287459b79b597ec2` |
| `tali-nemoclaw-deepagents-sandbox` | `565b42b8fdd95076c19e4a9c9462c08b454cd75988cfb0426a698374177e35e9` |

Completed automated checks: Runner 82 tests; Control 104 targeted tests plus the
new OpenClaw subscription regression; chart packaging and ownership checks;
airgap image validation and resource validation for 19 containers. All image
build probes passed, including native Hermes Hindsight and real configuration
bootstrap checks. `git diff --check` passed.

Browser acceptance completed on 2026-10-24 using the existing Relay model
Routing. No provider-specific routing changes were required.

| Surface | Result |
| --- | --- |
| OpenClaw native UI | Original chat history remained visible; the final Control image streamed `OPENCLAW-FINAL-138-OK` through the same-origin HTTP/WS path. |
| Hermes Native | Native configuration has an empty external provider selector (builtin); a new UI session recalled the pre-upgrade `COPPER-PINE-724` memory. |
| Hermes with Memory | Native configuration selects `hindsight`; the UI's Hindsight Recall tool recovered pre-upgrade `AMBER-KITE-826`. Hindsight Retain then stored `JADE-FALCON-138` in session `64aea3f8`, and Hindsight Recall returned it in new session `4759513a`. |
| Deep Agents Code | Native TUI in Relay returned `DEEPAGENTS-UI-138-OK`. Headless inference and official stop/start also passed, including `DEEPAGENTS-RESTART-OK`. |
| Authorization | Unauthenticated native UI requests returned 401. The existing Project-scoped session received 403 for an Instance lookup in another Project. |
| Runtime/data | All seven local Instances and all three Project Gateways were Ready. Five Agent PVCs and both pre-existing system PVCs retained their original UIDs. |

The final local Control image ID is
`1761b415e1936111bc4ed86ba32f00b79eb1d69daf4e78ab331d506e2d47e040`;
Runner is `de7c5352da9e4e45ed24d778adca284d7fda4ae89944d43393fbab00f75bcb86`.
Control and Runner type checks passed. Detailed local evidence is saved in
`output/nemoclaw-0.0.138-upgrade/acceptance.json` and the accompanying screenshots.

### Remaining native UI limitations

The isolated OpenClaw document cannot persist IndexedDB drafts across page
reloads. Its new UI can display a draft-storage notice; submitted chats and
server-side session history work normally. Keep the opaque-origin CSP instead
of granting the Agent document access to Control Plane browser storage.
Approval-event subscriptions requiring a paired browser device are excluded
from the backend message subscription.

Hermes displayed a host-memory warning during concurrent local builds and
multiple TUI sessions. The inspected Hindsight Agent used about 896 MiB of its
2 GiB cgroup limit, and no Agent or control-plane Pod had restarted during the
final check. This local regression is functional acceptance, not a concurrency
or production capacity benchmark.

## References

- [NemoClaw v0.0.138](https://github.com/NVIDIA/NemoClaw/releases/tag/v0.0.138)
- [OpenShell version contract](https://github.com/NVIDIA/NemoClaw/blob/v0.0.138/scripts/install-openshell.sh)
- [OpenShell v0.0.116](https://github.com/NVIDIA/OpenShell/releases/tag/v0.0.116)
- [Previous upgrade and Native Memory acceptance](nemoclaw-v0.0.123.md)
