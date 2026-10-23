# Work collaboration MVP — local implementation and acceptance

Updated: 2026-10-12. Baseline: `eea03a3`, local `main`. This document describes the implementation in this checkout, including its limitations. The untracked Harness PRD and flow documents that predated this implementation were preserved.

## Product boundary

The end-user flow is **Project → Work → optional Task**, with Run representing an execution attempt. Work is a continuing group conversation. Chat, board and artifacts read the same persisted Work state. A simple discussion does not create cards automatically.

An ordinary account with no previous Project membership receives its own empty **我的 Project** on first access selection. It is not assigned to the seeded/shared `proj1`. Initialization creates only the private resource container, Project, owner membership and a zero-funded quota. There are no seeded Providers, instances, Work groups, tasks or generated responses. Concurrent first-entry requests create one Project. Pending invitations are processed first. Existing revoked memberships are not silently restored; the fallback deliberately does not create another Project for an account with historical assignments.

The existing schema requires Department ownership. A private Department record supports this internally; the Project switcher displays “Personal / 个人资源”, not the opaque internal name. This is not a new Organization/tenant model. The personal account receives the ordinary user role. Personal onboarding now connects a user-supplied Provider/model, sets a requested Project quota, validates and publishes the default coordinator/expert, and creates their actual Work runtime instances. Skipping setup keeps empty entry available for recording work. This is BYOK configuration, not a purchase or credit top-up.

Admin and Agent Developer retain their existing routes and navigation. Only ordinary user home targets and the explicit `/$projectId/works` route use the independent end-user view.

## What is implemented

- Personal onboarding: connect Provider/model → prepare the two default roles → create a Work with an automatically assigned team and an optional, explicitly authorized first planning call. Successful preparation is persisted; a failed expert check preserves the coordinator for a manually confirmed retry.
- Warm neutral/purple desktop UI with Project switcher, Work navigation, goal, collapsed expert bindings, chat, optional Kanban and artifact panel. Light/dark themes use a scoped profile documented in `ui-interaction-spec.md`.
- Create a Work with zero cards; write trusted human messages; reopen and refresh; persist view preference. Current-user alignment uses server-supplied user ID, not display name. Voice is explicitly marked as a future feature.
- Fixed published Agent versions and actual Project instances can be bound as coordinator/expert. Missing/unready/unauthorized instances are excluded. No fake Agent fixtures are loaded by production entry points.
- Structured incremental plans, stable card IDs, dependency DAG validation, reasons and predecessor links. Completed/cancelled cards are immutable; running cards and their upstream context cannot be silently changed.
- Explicit one-call approvals, durable runs, Work model-call reservation, published-version checks and Project quota checks before inference. No automatic structured-format retry for Work calls.
- Cancellation propagation via AbortSignal, durable lease/fence checks, late-result audit, lease recovery, and human reconciliation of unknown inference outcomes. Unknown outcomes never auto-retry.
- Draft → manually verified → delivered artifacts with version, previous artifact, source message, Task, Run, instance and task-scope digest. Changed task scope, newer drafts and completed output cannot be overwritten through an old artifact.
- Durable sequenced events, command idempotency, revision conflicts, cursor queries, atomic snapshots and reconnect refresh. UI currently uses snapshot polling (3 seconds), not token streaming or SSE.

## Implementation map

| Path | Responsibility |
| --- | --- |
| `packages/contracts/src/works.ts` | Shared validation and identity/domain types |
| `apps/control/server/projects/personal-project.ts` | Empty private Project initialization |
| `apps/control/server/projects/personal-onboarding-service.ts` | Owner-only connection, quota, release validation and resumable team preparation |
| `packages/contracts/src/personal-onboarding.ts` | Setup input and public status contracts |
| `apps/control/server/secrets/database-secret-store.ts` | Encrypted persistent Provider credentials |
| `apps/control/server/works/personal-agent-template.ts` | Default role definitions and executable release evaluations |
| `apps/expert-agent-runtime/src/engines/work-text-engine.ts` | Published model-only planning and drafting engine |
| `apps/control/server/auth/access-context-service.ts` | First-entry fallback and role-specific destinations |
| `apps/control/server/works/work-service.ts` | Membership, bindings, commands, approvals, events and snapshots |
| `apps/control/server/works/work-domain.ts` | Plan/DAG validation and execution gate |
| `apps/control/server/works/work-worker.ts` | Durable dispatch, leases, fencing, cancellation and result commits |
| `apps/control/server/works/work-runtime.ts` | Published Agent runtime and real model adapter |
| `apps/control/server/routes/api/v1/projects/[projectId]/works/` | Authorized HTTP surface |
| `apps/control/src/features/works/` | End-user UI and scoped styling |
| `apps/control/prisma/migrations/20261012000000_work_collaboration/` | Additive PostgreSQL migration |

The four Work tables are aggregate state, messages, sequenced events, and durable runs. Two additional personal onboarding tables store preparation progress and encrypted managed credentials. Tasks, human membership, bindings and artifacts are validated fields within the Work aggregate. A row lock serializes command validation and event/state updates. Run insertion happens in the same transaction as the dispatch event/state update, so the run table is the transactional outbox. Existing pg-boss maintenance queues are unchanged.

The primary key and queries include Project/Work. HTTP admission uses the existing active Project context; service methods separately validate current Project membership, active account/Department and Work membership. Instances additionally require Project ownership and instance owner/expert relation access. Human author fields are never accepted from the browser. Agent messages are only written after the worker validates a fenced result. Work owners can edit human membership through the validated `members` command; a dedicated member-picker UI is not included yet.

## Runtime and isolation limits

This adapter executes **model-only text work** through the existing `ExpertAgentRuntime` library, immutable published version, resource binding service, Project model routing and LiteLLM quota/key services. It uses the bound instance's published instruction and safety constraints. Personal setup publishes the `WORK_TEXT` engine and creates version-pinned `WORK_AGENT` instances for the Work worker. These are not Kubernetes deployments; existing `PROJECT_AGENT` bindings remain supported. It does not invoke a Kubernetes instance's A2A endpoint; business Task and A2A protocol Task are not conflated, and no new A2A mapping is claimed.

Coordinator context includes at most twelve prior Work messages, the goal, cards and bindings. Expert context contains its assigned task and delivered dependency artifacts with provenance. Other Work messages, Project-wide Memory and knowledge are not injected. Published Agent instructions are executable product configuration; retrieved/user content is data.

File, shell, browser, MCP and knowledge/Memory tools are **not exposed** by this adapter. Calls to MCP/knowledge adapters reject. This is denial of unavailable tools, not a claim of a new filesystem or OS sandbox. No path/symlink/mount isolation has been implemented or certified for Work tools. A future adapter must enforce real Work-specific runtime permissions before enabling those tools. Existing Project runtime resources are unchanged.

Model dispatch checks Project quota synchronization/spend plus the Work's default limit of twenty dispatch reservations. The gateway remains responsible for monetary accounting and its hard-budget behavior. There is no atomic cross-Work USD reservation, invoice reconciliation, exact cost forecast or budget editing UI in this MVP. The UI explains that planning/drafting calls contribute to Project usage.

Each run pins an input hash, requester, target instance/version, scope and fifteen-minute approval expiry. Runtime creates a short-lived two-minute model-only key with Project/Work/Run attribution and attempts revocation afterward. Immediately before the network request, quota, current membership, binding, approval, lease/fence and Work call allowance are checked again. Keys and Provider response bodies are not written to chat. A failed result after dispatch is conservatively unknown, including possible inference cost.

Worker lease is ninety seconds; model request timeout is sixty seconds. Cancellation stops new calls and aborts the transport wait, but does not promise the Provider stopped billing. A persisted dispatch reservation distinguishes lease expiry before dispatch from unknown outcome after dispatch. The requester/Work owner records reconciliation evidence before closing an unknown attempt; closure neither retries nor delivers an artifact. Another execution requires new authorization. This reconciliation path is only appropriate for the current inference-only adapter, not future payments/email/tools.

## Run locally

Use a dedicated PostgreSQL database and a dedicated TOML config, following `docs/control-configuration.md`. Do not point integration tests at shared or production databases. Required packages are already repository dependencies.

From repository root:

```sh
npm run build --workspace @tali/contracts
TALI_CONFIG=/absolute/path/work-dev.toml npm run db:migrate --workspace @tali/control
```

Start Web from `apps/control` (example unused local port):

```sh
TALI_CONFIG=/absolute/path/work-dev.toml node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5187 --strictPort
```

Start only the Work queue worker from repository root:

```sh
TALI_CONFIG=/absolute/path/work-dev.toml npm run dev:work-worker --workspace @tali/control
```

The regular production Control Worker also starts the Work worker. Do not launch the full maintenance worker merely to test this UI. The dedicated dev worker does not require kind or start Kubernetes jobs. This change has not been deployed, committed or pushed.

This session used container `relay-work-dev-20261012`, database `relay_work`, config `/tmp/relay-work-control.toml`, Web `http://127.0.0.1:5187`. Docker allocated host port 32768 initially and 32769 after its restart; the isolated config was updated accordingly. Inspect this container's port if restarting it again. No other containers/services were restarted or removed. Test credentials reside in the isolated config/database and are not production credentials.

## Reproduce the user flow

1. Sign in with an ordinary account that has no previous Project membership. The only access option selects automatically and opens `/<personal-project-id>/works`.
2. Choose “开始一件工作”, enter a title and goal. The Work has zero Tasks and zero instances.
3. Send a message with the button or Cmd/Ctrl+Enter. It appears on the right for its authenticated author. Open the board: it still has zero cards.
4. Reload, reopen the URL, and restart the isolated Web/database. The message, Work and view preference persist.
5. To enable execution, open “模型与团队 · 待设置”. Select the Provider, supply its API key and exact model ID, and confirm a Project budget. “验证并继续” runs the existing Provider connection/discovery/probe flow. “准备我的团队” configures routing/quota and performs one real structured-output release check per missing role, publishing only passing roles. Create a new Work; it receives both instances automatically. Confirm the checkbox to authorize its first planning call. For a returned task, click “授权生成草稿”, read the actual output, record verification evidence, and deliver it. Existing Work groups can bind the now-ready instances under 群成员; setup does not silently change existing groups.
6. If no real instances exist, the selection is empty and planning remains disabled. Human discussion continues. No fake replies or tasks are generated.

The initial acceptance run had no real Provider or configured gateway. The subsequent NVIDIA live run below now validates step 5 for a model-only text task, including manually reviewed delivery. Earlier TEST ONLY results remain separate from this live evidence. Integration tests inject explicitly labeled TEST ONLY adapters into the worker and clean up their own synthetic records. Those passing tests are not Provider E2E evidence.

## Acceptance evidence

| User checklist | Status | Evidence / limitation |
| --- | --- | --- |
| 1. Zero-Task Work and durable messages | Pass | Browser created a personal Work, sent via Cmd+Enter, reloaded and reopened it. Actual PostgreSQL container and Web restart retained Project, Work, message and view. PostgreSQL test also opens a new Prisma client. |
| 2. Two humans + Agent identity/alignment | Pass in tests; multi-login visual check incomplete | Same-display-name humans have distinct trusted IDs; forged authors rejected; Agent result author comes from bound instance. Personal user's own message visibly renders right. |
| 3. Project/Work and runtime isolation | Partial | Unauthorized snapshot/event/list operations fail closed; model context stays scoped. File/Memory/tool access is disabled, not implemented as a Work sandbox. |
| 4. Revisions, idempotency and safe plans | Pass in tests | Concurrent creation/messages, replay, stale revision, changed payload, DAG cycles, unknown owners, immutable history and active dependency protection. |
| 5. Shared state and recovery | Pass for snapshot model | Chat/board/artifacts share aggregate; cursor sequence/replay uniqueness tested, reload/restart verified. No SSE/token streaming. |
| 6. Approval and budget gate | Call gates tested; live Project usage verified, monetary enforcement incomplete | Expired/changed authorization, exhausted call allowance and cancelled queued requests produce zero adapter tool calls. NVIDIA live key issuance and $1 Team configuration succeeded. A nonzero charge, exhaustion boundary and upstream invoice reconciliation remain unverified. |
| 7. Cancellation and late output | Pass in PostgreSQL tests | In-flight cancellation fences output; unknown is never retried; lease expiry distinguishes dispatch reservation; reconciliation does not rerun. |
| 8. Provenance and immutable delivery | Pass in tests and NVIDIA live review/delivery | Draft version/provenance, evidence requirement, stale task-scope rejection and delivered artifact protection. The live task delivered v4 after review; v1–v3 remain unverified drafts. |
| 9. Admin / Developer regression | Partial | Access-context, route capability and navigation regressions pass. Admin account/overview and Agent Developer entry/home/navigation observed in the browser; logout returns to sign-in. Full build/evaluation/publish workflow not exercised without runtime/model configuration. |
| 10. Tests/typecheck/build/migration | See recorded commands below | Real isolated migration, targeted PostgreSQL/unit tests, full typecheck and production build. |

A model-only multi-Agent delivery chain has passed live NVIDIA validation. The release gate is **not passed** for a full tool-enabled Harness. Remaining work includes finer-grained cost attribution, runtime tool isolation and the richer membership/approval/budget interfaces described above.

## Verification commands

```sh
WORK_TEST_DATABASE_URL='<isolated-local-relay_work-connection>' npm exec --workspace @tali/control -- vitest run --config vitest.config.ts server/works server/auth/access-context-service.test.ts server/authorization/route-capabilities.test.ts server/projects/project-service.test.ts server/expert-agents/structured-project-completion.test.ts src/components/layout/app-shell-navigation.test.ts
npm run typecheck --workspace @tali/control
npm run build --workspace @tali/control
git diff --check
```

Integration tests run only when `WORK_TEST_DATABASE_URL` is set. They require a localhost database whose name includes `relay_work`; without it they skip and must not be reported as passed integration coverage.

Recorded results on 2026-10-12:

- Targeted suite: **8 test files, 94 tests passed**, including the actual isolated PostgreSQL cases (15.17 seconds).
- Contracts build: passed. Isolated `prisma migrate deploy`: passed for the baseline and additive Work migration. Migration validation: **2 migration directories passed**.
- Full Control typecheck: passed. An initial concurrent typecheck/build attempt collided while both regenerated the same Prisma client; the typecheck passed when rerun sequentially. Run these commands sequentially.
- Full Control production build: passed, including Web, Control Worker, reconcile, runtime bridge and Hindsight router bundles. Vite reported its large-chunk warning; no build errors.
- `git diff --check`: passed.

Logs from this session: `/tmp/relay-work-tests.log`, `/tmp/relay-work-typecheck.log`, `/tmp/relay-work-build.log`, `/tmp/relay-work-worker.log`. Screenshots: `output/work-validation/personal-work-light.png` and `personal-work-dark.png`. These screenshots show real saved human messages and truthful empty boards, not seeded Agent results.

Desktop visual checks cover 1600×1000 and 1200×800 CSS pixels, visible keyboard focus, Cmd+Enter, light/dark contrast and horizontally scrollable Kanban. Browser-native zoom at 200% and a full populated-board visual review remain unverified. Mobile/tablet acceptance is excluded by AGENTS.md.


## Personal onboarding acceptance — 2026-10-12

### Deployment prerequisites and boundaries

- Apply both additive migrations `20261012100000_personal_onboarding` and `20261012101000_work_agent_version_guard` after the Work migration. The latter extends the existing version-reference trigger for real `WORK_AGENT` records while preserving its Project/version checks.
- Configure the existing LiteLLM gateway and master credential using the existing Control configuration. Onboarding uses this gateway for model registration, routing, Project quota and scoped keys; this increment does **not** remove LiteLLM or provide a standalone gateway. The isolated NVIDIA preview now uses a dedicated live gateway on port 5190.
- Keep `auth.secret` stable and protected: it is the root for Project/resource-separated encrypted database credentials. Rotation requires a credential migration or reconnect strategy; the current implementation does not re-encrypt old records automatically. Neither the public setup response nor browser storage contains the API key.
- Known Provider origins are fixed. Custom compatible origins must be explicitly configured with `TALI_PERSONAL_PROVIDER_ORIGINS` as a comma-separated list of exact origins. This is a deployment setting, not a normal-user bypass; do not allow untrusted internal endpoints. Provider discovery redirects are rejected.
- The budget entry is a requested 30-day Project limit, synchronized to the gateway, not prepaid credit. Existing registration probes can run outside Project-key accounting; the interface discloses this. Real gateway enforcement, Provider invoice reconciliation and exact aggregate costs are not certified by these tests.
- Default roles operate on supplied text. Browser, shell, Skill/MCP and Memory execution are not enabled by this Work adapter. The UI presents them as a coordinator and a general work expert, with no fabricated external research.
- Only the owning ordinary user can configure the private Project. Enterprise Projects remain ineligible, and no Admin or Developer role is granted by onboarding.
- Revision checks plus an operation lease prevent concurrent setup. Failed steps retain saved resources. Continuing is explicit and can incur another model call; interrupted or uncertain model responses are never automatically retried.

### New verification results

- **12 Control test files / 99 tests passed**, using the isolated PostgreSQL database. Coverage includes ownership rejection, encrypted secret persistence, concurrent connection, one-role failure and explicit recovery, actual lifecycle release gates, default bindings, idempotent create-and-plan, Work worker dispatch, draft verification and delivery. Gateway/model network calls are explicitly **TEST ONLY** adapters. This is not live Provider evidence.
- **8 runtime test files / 37 tests passed**.
- Full repository `npm run typecheck` and `npm run build` passed sequentially. Build retains Vite's large-chunk warning.
- Additive database migrations applied successfully to the isolated database only; no shared database was migrated.
- Browser: actual personal account can open setup, skip to its persisted Work/message, reopen setup, and see a denied custom endpoint without a Provider request. Light-theme onboarding inspected at 1600×1000 and 1200×800 desktop sizes. Existing Work light/dark evidence remains above; new onboarding dark-theme and 200% zoom acceptance are not yet verified.

Reproduce the Control suite:

```sh
WORK_TEST_DATABASE_URL='<isolated-local-relay_work-connection>' npm exec --workspace @tali/control -- vitest run --config vitest.config.ts server/projects/personal-onboarding.test.ts server/projects/personal-onboarding.postgres.test.ts server/works server/auth/access-context-service.test.ts server/authorization/route-capabilities.test.ts server/providers/provider-adapters.test.ts server/providers/provider-service.test.ts server/expert-agents/expert-agent-validation-service.test.ts server/expert-agents/expert-agent-lifecycle-service.test.ts src/components/layout/app-shell-navigation.test.ts
npm run test --workspace @tali/expert-agent-runtime
npm run typecheck
npm run build
```

New logs: `/tmp/relay-onboarding-tests.log`, `/tmp/relay-onboarding-runtime-tests.log`, `/tmp/relay-onboarding-typecheck.log`, `/tmp/relay-onboarding-build.log`. Screenshots: `output/work-validation/personal-onboarding-light.png`, `personal-onboarding-error.png`.

For another live acceptance, use an explicitly supplied credential/config location and a bounded budget, follow step 5, then record actual Project/Work/Run/instance IDs, outputs, review evidence and gateway usage. Do not promote test adapter results or a successful setup screen to evidence of real delivery.


## NVIDIA live validation — completed text-task loop

The user supplied `.env` / `NVAPI_API_KEY` for NVIDIA. The secret was read locally without printing it. NVIDIA NIM is now a first-class personal onboarding option, restricted to `https://integrate.api.nvidia.com`. The model catalog returned `openai/gpt-oss-20b`; a single direct structured-output compatibility probe returned HTTP 200, `{\"ok\":true}`, 71 input tokens and 19 output tokens. This direct probe is outside the Project gateway and is not evidence of task completion or Project billing.

The real Project flow will use the isolated gateway on `127.0.0.1:5190`, a separate `relay_work_litellm` database in the existing test PostgreSQL container, and a $1 Project limit. The repository-pinned gateway image is `ghcr.io/tasklattice/tali-litellm:1.87.0-guard.3`. Neither an upstream invoice nor a universal $1 hard spending guarantee is inferred from the local setting.

NVIDIA-specific origin/contract checks and Provider adapters: 11 tests passed. Control typecheck and production build passed. The live delivery evidence follows.


### Live result and review evidence

- Project: `tp-cdtsixla2y6bc`; owning ordinary account: `work-personal-ui-test`.
- Provider: NVIDIA NIM; Model: `openai/gpt-oss-20b`.
- Work: `676a1903-791c-4cf2-9fcf-b27111a40ec1` — NVIDIA 实测：简化个人首次体验.
- Coordinator instance: `personal-work-coordinator-17358e71-ca07-4b96-82e1-02d3b9bf43e6`.
- Expert instance: `personal-work-expert-b2e5af30-26c1-4c4a-b722-2328c02d9d12`.
- Planner Run: `66ad47c0-0d32-4ce8-aa48-2457f3d198dd`; automatically created `R-1` and assigned the prepared expert.
- Final execution Run: `2e2bdc84-b127-4208-aa4b-73b4597c2488`.
- Delivered artifact: `9bc00daf-4730-46c4-9b79-11192f815945`, version **4**, Work revision **19**, Task **done**.
- All five Work Runs completed: one planning call and four explicitly initiated draft calls. Nothing retried automatically.
- v1 was only an introduction, v2 was incomplete, and v3 invented an unsupported current time baseline. These were not verified or delivered. v4 includes all three requested problem/action/acceptance sections, discloses the lack of outside research, and labels numeric acceptance criteria as assumptions requiring validation in its evidence.
- Review and delivery were performed in the actual browser. Review evidence explicitly limits approval to document completeness, states the current baseline is unknown, and does not claim that the proposed functionality or targets have been achieved. v1–v3 remain `draft`; only v4 is `delivered`.

Inspect the persisted evidence: `output/work-validation/nvidia-live-delivery.json`, `nvidia-onboarding-ready.json`, and `nvidia-live-delivered.png`. Local preview: `http://127.0.0.1:5187/tp-cdtsixla2y6bc/works?work=676a1903-791c-4cf2-9fcf-b27111a40ec1`.

### Defects found by live testing

1. SINGLE Routing aliases were absent from temporary key configuration in both onboarding and Work execution. The gateway rejected the first release-check request before NVIDIA inference. Added `server/works/work-model-key.ts` to resolve the selected validated deployment into a key-scoped alias, while keeping the allow-list on the public routing identity and disabling retries/fallbacks. The PostgreSQL regression checks both paths' actual key arguments.
2. Native constrained decoding alone did not reliably produce a complete document. `WorkTextEngine` now sends the response schema in the model prompt as well as in `response_format`, explains JSON string/newline rules, requires complete deliverables, and distinguishes unknown measurements from tentative targets. These prompts do not guarantee correctness; review through the user approval flow caught the failures; the product continues to require review. This live test review was performed by the coding assistant through the isolated test account, not by the end user.
3. PostgreSQL test files shared a durable queue, so one test worker could consume another file's synthetic Run. When `WORK_TEST_DATABASE_URL` is set, Vitest now runs files sequentially. The updated five-file / **38-test** integration and domain suite passed; runtime **37 tests** passed; full repository build and Control typecheck passed after the fixes.

### Accounting evidence and remaining limits

At final verification, the Project fact table contained **8 request records: 7 successes and 1 gateway rejection**, **6,125 input + 3,267 output = 9,392 tokens**. Cost source was `litellm:spend`; total recorded cost was **$0**. The gateway Team had `max_budget = 1`, `spend = 0`.

The model-registration probe was outside the Project Team (70 tokens); the direct compatibility probe was outside the gateway (90 tokens). Across all successful NVIDIA calls used in this session, reported usage was **9,552 tokens**. These are token measurements, not proof of a zero NVIDIA invoice. No nonzero monetary charge or real exhausted-budget boundary was exercised.

At the first live-delivery checkpoint, Project ownership of spend was verified. **That checkpoint lacked per-Work / instance / Run cost attribution (superseded for new calls by the billing acceptance below):** temporary keys carried server-generated context when issued, but the gateway spend payload did not preserve it into those fact-table fields. Those fields remain empty; they have not been fabricated or backfilled by guessing. A durable temporary-key attribution mapping and corresponding ingestion tests are follow-up work. Keep this separate from the completed task/provenance audit trail.

The standalone text worker and isolated gateway remain available locally. The image is pinned to digest `sha256:d4aa2dadb233f6475edd8b063eda40ab1a9f50b78bb303266a5b0f0d0d4c3eaa`. Gateway container: `relay-nvidia-gateway-20261012`; database: `relay_work_litellm`. Configuration remains under `/tmp` with restricted permissions; no credential was added to repository source or screenshots. No commit, push or shared-environment deployment was performed.


## Work billing acceptance — 2026-10-12

The existing LiteLLM → CostService → `model_usage_fact` pipeline now carries `workId`, `taskId`, `workRunId` and Agent instance attribution. No second financial ledger was introduced. Migration `20261012110000_work_cost_attribution` is additive; apply it before deploying the updated Control and Work worker.

- A temporary key's server-selected Work, Task, immutable Run and instance are recorded before inference. Only normalized key fingerprints are stored; revocation/expiration never removes the attribution ledger.
- Planning is billed to the Work and coordinator instance. Expert execution is billed to its Work, Task and instance. Task IDs are Work-scoped, so two `R-1` cards cannot merge. The Task report separates known Work planning from genuinely unmapped historical usage.
- Chat/model-supplied metadata is not authority for billing attribution. Matching requires an exact key identity for Work records; a shared Team is never enough to select an instance. Ambiguous mappings remain unattributed.
- Repeated ingestion keeps the same request and amount. Rows missing Work attribution can be enriched from an exact persisted key mapping, with an observation record, without changing costs/tokens or replacing a known scope. Old calls with no durable mapping remain unmapped.
- Existing cost summary, breakdown, ranking, activity, trend, filtering and CSV support Work and Task alongside instances. Personal Work navigation includes 用量与费用, prefiltered to the selected Work when one is open. Personal Project owners may read their own costs and data quality without gaining enterprise administrator/developer or budget-edit permissions. Enterprise RBAC remains in effect.

Live fixture: `NVIDIA 计费归属验证`, Work `7bd4e9ac-b18b-4f81-9457-e25eaa64bda3`, personal Project `tp-cdtsixla2y6bc`, NVIDIA NIM `openai/gpt-oss-20b`.

| Call | Input tokens | Output tokens | Total | Attribution |
| --- | ---: | ---: | ---: | --- |
| Coordinator planning | 1,302 | 482 | 1,784 | Work + coordinator instance + WorkRun |
| Expert text draft | 1,134 | 379 | 1,513 | Work + Task + expert instance + WorkRun |
| Total | 2,436 | 861 | 3,297 | Two unique gateway requests |

The two real temporary keys were absent from the gateway's verification-token table after execution. Late spend still resolved to both instances and Runs. The filtered cost API reports zero unmapped requests, zero token mismatches and zero uncorrelated Runs for this Work. Gateway-reported spend was **USD 0**; this does not establish NVIDIA's invoiced price. No nonzero real provider invoice was available. The expert output remains a draft; billing verification does not stand in for user acceptance of its wording.

Budget validation covered: exhausted Work dispatch allowance (no tool call), exhausted Project dollar budget (production adapter rejects before inference), nonzero synthetic costs in the existing aggregation, and the actual local LiteLLM budget gate. The latter used a separate temporary Team with USD 0.0001 limit and synthetic USD 1 spent; it returned HTTP 400 with an explicit budget error before reaching any upstream model. That Team and key were deleted afterward. This synthetic fixture was never inserted as real Project spend.

Limits remain Project USD quota / gateway Team budget and Work model-dispatch count. Work/Task/instance reporting does not create new monetary sub-budgets. Reported Project spend is asynchronous; the gateway owns its budget enforcement. These checks do not certify an exact no-overshoot dollar reservation under concurrent in-flight requests or missing provider pricing.

Validation: **77 tests across 10 files passed**, including real PostgreSQL concurrent duplicate ingestion/enrichment and zero-dispatch budget checks; Control TypeScript and full repository production build passed. Desktop UI verified Work/Task selection, filtering, and the ordinary personal account's billing access. Evidence: `output/work-validation/work-billing-live.json`, `gateway-budget-check.json` and the billing screenshot. No shared environment, commit or push was changed.

## Ordinary-user entry direction — confirmed 2026-10-12

Default entry should be a Harness-style input box with document attachments that starts a Task. A Slack-style working conversation, specialist participation, board and artifacts appear when collaboration is useful. These are two presentations of the same task and billing data; users should not configure groups or expert infrastructure before stating their goal. Provider, Model, Skill and MCP remain progressively disclosed in settings. This is the next interaction-design direction, not a claim that attachment execution or the entry redesign is implemented in this billing change.
