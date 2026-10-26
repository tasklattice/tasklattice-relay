# Durable Memory automated acceptance

Run the complete repeatable gate from the repository root:

```bash
npm run test:durable-memory:acceptance
```

The command runs focused Control and Runtime suites, the pinned real Hindsight
container integration, Kubernetes and OpenShift manifest checks, additive
database migration validation, and a production-source mock/fallback scan.

| # | Scenario | Automated evidence |
| --- | --- | --- |
| 1 | Automatic binding | Instance lifecycle plus Memory service tests assert one ready Memory, one active binding, and idempotent replay |
| 2 | Instance destroyed, Memory survives | Instance deletion and runtime continuity tests assert unbound Memory, Bank/content retained |
| 3 | Same-runtime rebuild | OpenClaw continuity test recalls from the unchanged Memory/Bank |
| 4 | Cross-runtime continuity | Hermes-to-OpenClaw and OpenClaw-to-Hermes service and bootstrap tests |
| 5 | Fact revision | Governance test asserts optimistic update and current recall value |
| 6 | Invalidate/restore | Provider contract and governance status-overlay tests |
| 7 | Evidence linkage | Conversation redaction/deletion tests invalidate unsupported derived items |
| 8 | Provider outage | Runtime fail-open plus encrypted outbox retry/exact-once delivery tests |
| 9 | Isolation attack | Project repository predicates, admission, and signed runtime-token forgery tests |
| 10 | Complete deletion | Bound-delete block, provider absence verification, failure retry, and Project purge tests |
| 11 | Secret exclusion | Sanitizer, provider payload, structured log/error, audit, export, metrics, and UI projection tests |
| 12 | Role UI | Built-in role, permission projection, navigation, and action visibility tests |
| 13 | State UI | SSR component tests for loading, empty, error, degraded, deletion failure, retry, conflict, and pagination |
| 14 | OpenShift | Arbitrary UID, read-only filesystem, private Services, and minimal RBAC manifest validator |
| 15 | Upgrade compatibility | All Prisma migrations apply over the existing seeded Project/Instance fixture without destructive rewrite |
| 16 | No mock production path | Source gate rejects Fake provider or fixed Memory fallback references outside tests and verifies Hindsight-only factory |

The live Hindsight leg uses the reviewed pinned image and actual API/worker
processes with PostgreSQL/pgvector. Test-only deterministic embeddings keep the
gate repeatable; they are not linked into a production bundle.

## Hindsight 1.1 and native coding agents — 2026-10-24

Deployed and verified on OrbStack, infrastructure namespace `tali`, Project
`tp-v3i65n4c7jslo`, through `http://localhost:38080`. Both Agents were created
through Relay with Memory enabled and the bundled Skill attached automatically.

| Component | Pinned version |
| --- | --- |
| Hindsight API | `1.1.0-slim`, digest `sha256:b97af4787f35f0f897cc85299e1c800e265ff98e1d70c900c58a7f9903cb5b7d` |
| Relay Hindsight SDK | `1.1.0` |
| Official coding-agent plugin and Skill | `@vectorize-io/hindsight-coding-agents@0.8.2` |
| NemoClaw | `v0.0.138` |
| Dcode / Deep Agents SDK | `0.1.71` / `0.7.15` |
| Pi | `0.84.1` |

The database was backed up before running the upstream 1.1 migration. Helm
defaults, the airgap image list, integration fixtures, and SDK are pinned to 1.1;
there is no previous-version compatibility branch. The upgrade required:

- Replacing the removed Bank profile endpoint with Bank config for existence
  and deletion verification, and keeping retry deadlines under Relay control.
- Binding knowledge-page operations to Hindsight's task-local Bank context so
  inference keeps Project isolation. Concurrent calls and exception cleanup
  were checked against the actual 1.1 image.
- Accepting the native plugin's strict document tag filters without admitting
  Bank overrides or administrative endpoints.

The native plugin and dependencies are installed during image build. Startup
uses the local bundle with automatic updates disabled. Dcode's pinned
`--no-mcp` mode loads only the fixed Hindsight server when Memory is enabled;
arbitrary additional MCP configuration remains ignored. The child process gets
the OpenShell proxy and CA settings needed for scoped runtime access.

| Acceptance | Dcode | Pi |
| --- | --- | --- |
| Relay creation with Memory and automatic Skill | Passed | Passed |
| Native TUI write using `hindsight_ingest_document` | `COBALT-FERN-593`, `ok: true` | `AMBER-KITE-826`, `ok: true` |
| Recall from a new empty session | Native `reflect` returned the stored fact | New Pi session returned the stored fact |
| Recall after actual OpenShell stop/start | Native `reflect` returned `COBALT-FERN-593` | Native `reflect` returned `AMBER-KITE-826` |
| Startup with no network interface | Eight native MCP tools loaded | Native extension imported |
| Native mode without Memory | No Hindsight MCP tools | Hindsight extension disabled |
| Other Instance Bank / coordinator access | Denied | Denied |
| Bank query override / administration | Denied | Denied |
| Other Project bridge access | Denied | Denied |
| Foreign Bank canary in scoped recall | Absent | Absent |
| npm / PyPI access in deployed sandbox | Blocked | Blocked |

Recall prompts did not contain the stored codenames. The successful TUI runs
used native Hindsight tools without reading files or local conversation history.
The new-session Dcode test opened a fresh empty TUI; `/new` is a Pi command,
while Dcode provides `/clear`. Reconnection after restart also clears Relay's
stale terminal-disconnected notice.

Offline startup is checked with `docker --network none`; actual memory calls
still require the internal Hindsight service and configured model endpoints.
The test does not claim disconnected inference. Knowledge-page search returned
HTTP 200 with no pages for these test Banks, which had no codebase survey.

Repeatable checks added for this integration:

```bash
python3 scripts/testing/hindsight-coding-runtime.test.py
python3 scripts/testing/dcode-hindsight-mcp.test.py
bash scripts/testing/coding-hindsight-offline.sh
```

`scripts/testing/hindsight-bank-context.py` runs inside the pinned provider image.
`scripts/testing/probe-coding-memory.mjs` runs through `openshell sandbox exec`,
using the effective sandbox network policy and credential substitution. It
checks the 1.1 version, query restrictions, cross-Bank and cross-Project access,
foreign canaries, and package registry denial without printing credentials.

Focused Control, Runner, SDK/provider, and runtime-bridge suites passed, as did
the real Hindsight 1.1 PostgreSQL lifecycle integration, Python bootstrap tests,
Control/Runner typechecks, Helm/OpenShift/airgap validation, test-module checks,
and the 16-artifact Skill catalog check.

Evidence is in [`output/coding-hindsight-acceptance`](../output/coding-hindsight-acceptance/):

- [Dcode write](../output/coding-hindsight-acceptance/dcode-write.png),
  [new-session recall](../output/coding-hindsight-acceptance/dcode-session-recall.png),
  [restart recall](../output/coding-hindsight-acceptance/dcode-restart-recall.png).
- [Pi write](../output/coding-hindsight-acceptance/pi-write.png) and
  [restart recall](../output/coding-hindsight-acceptance/pi-restart-recall.png).
- [Skill Hub](../output/coding-hindsight-acceptance/skill-hub.png),
  [offline startup](../output/coding-hindsight-acceptance/offline-install.txt),
  [Bank context](../output/coding-hindsight-acceptance/bank-context.txt).
- [Dcode isolation](../output/coding-hindsight-acceptance/dcode-isolation.txt),
  [Pi isolation](../output/coding-hindsight-acceptance/pi-isolation.txt),
  [deployment](../output/coding-hindsight-acceptance/deployment.json), and
  [built image digests](../output/coding-hindsight-acceptance/images.txt).
