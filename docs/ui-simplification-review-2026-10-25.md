# Instance and Memory interaction review

Scope: desktop Project administrators and Agent operators finding an Instance,
opening its native UI/TUI, and inspecting assigned capabilities and Memory.
This is a targeted simplification under `AGENTS.md` and
[the shared interaction contract](ui-interaction-spec.md), not a product-wide
redesign or release certification.

## Decisions

- Default Instance columns emphasize source, owner, modified time, status, and
  access. Runtime, version, and creator remain available in Columns. Existing
  explicit preferences are retained; Restore defaults applies the simpler set.
- Show relative timestamps and display names once. Keep exact timestamps and
  usernames in their existing title attributes.
- Keep one primary access action in the detail header. Remove repeated profile
  summaries, capability counts, the noninteractive Ways to work card, and
  disabled edit/restart placeholders. Preserve capabilities, instructions,
  Memory, policy boundaries, lifecycle feedback, logs, and deletion controls.
- Show the actual reason when native UI/TUI access is unavailable.
- Remove the inactive global search placeholder and redundant page descriptions.
- Memory rows emphasize names and bindings. UUIDs remain on the resource link
  title and in details; remove the duplicate Available to attach caption.
- Distinguish initial inventory loading and errors from a genuinely empty
  Project. Provide Retry on initial failure; retain available rows on background
  refresh failures. Keep count, Columns, and Refresh together when wrapping.

No API contracts, authorization rules, resource data, or backend fields changed.

## Evidence

- Control typecheck passed. Column preference and Instance detail-model tests:
  2 files, 13 tests passed. Production image built and rolled out to OrbStack's
  `tali/tali-relay-control`.
- Browser verified column toggling, persistence after reload, Restore defaults,
  Escape returning focus to Columns, and opening/canceling the real creation
  drawer without creating resources.
- Final deployed route visibly showed Loading Instances before the empty
  state. Memory exposed its real missing-embedding prerequisite and recovery
  link. API-failure injection was not performed; Retry is code-reviewed only.
- Inspected light/dark desktop screenshots. At the measured 1270 CSS-pixel
  desktop width, page scroll width was also 1270 and no broken images were
  found. A temporary wider viewport reported 2286 CSS pixels with no overflow;
  the browser override was reset. Exact requested viewport sizing and browser
  zoom acceptance remain unverified because the automation viewport did not
  match the requested dimensions.
- Browser console inspection returned no warnings or errors. Theme was restored
  to the original System preference; temporary dark preview was not saved.
- Earlier populated-page evidence is retained under
  `output/ui-simplification-review/`: `instances-before.png`,
  `detail-before.png`, `memory-before.png`, and `memory-after.png`.
  Final `instances-empty-light.png` includes the corrected toolbar grouping;
  `instances-empty-dark.png` predates only that final grouping adjustment.

The local cluster no longer contained the previous Pi/Dcode Instances or Memory
records during final acceptance. The absence of Agent pods was verified in both
Project namespaces. Therefore populated Instance rows, the updated overview,
and native TUI launch cannot be claimed as browser-verified in the final build.
No replacement resources were created solely for this visual review.

## Review gate

Subchecks use 0 (missing), 1 (partial), 2 (verified), normalized to 10:

| Dimension | Subcheck evidence | Score |
| --- | --- | ---: |
| Product intent | Visible create entry 2; native access path 1 | 7.5 |
| Information architecture | Default disclosure 2; detail deduplication 1 | 7.5 |
| System craft | Paired themes 2; overflow 2; exact zoom/resize 1 | 8.33 |
| Trust and domain fit | Loading truth 2; prerequisite recovery 2; access restrictions 1 | 8.33 |
| Interaction readiness | Preference persistence 2; focus return 2; live error retry 0; populated detail path 0 | 5 |
| Visual and brand expression | Shared tokens 2; desktop screenshot review 2 | 10 |

Product Console weighted score: **7.57/10**. The full `release_gate` remains
incomplete due to missing populated-detail and error-recovery browser evidence.
Next verification needs an existing ready Instance and Memory, then opening the
native UI/TUI, checking the updated overview, and exercising a recoverable
inventory failure. Do not treat the passing build or empty-state screenshots as
proof of those paths.

## Instance detail tabs — follow-up review

Reviewed the existing Hermes / OpenShell Instance `ti-zlo2a2ovsrb4m` in Project
`tp-yhe34of3ynipr`. The target is a desktop administrator inspecting an existing
Instance and finding its configuration, resources, events, logs, and terminal.
This pass uses the `prototype` gate against the local client preview connected
to the existing backend; it does not represent a deployment.

| Tab | Observed duplication or layout issue | Result |
| --- | --- | --- |
| Overview | Instructions and full resource lists repeated their owning tabs; runtime and access repeated the header | Linked resource counts and operating context; provisioning feedback preserved |
| Configuration | Current policies appeared both as links and as selected editor chips; name/runtime repeated the header | Persisted references shown once; explicit Edit policies drawer; identity uses the Instance ID |
| Capabilities | Generic group descriptions, repeated policy counts and Instance name, and three large empty resource cards | Compact runtime feature matrix; one divided resource surface; effective tool access lives with MCP Servers |
| Activity | Static coordination/delegation settings repeated Capabilities; every log entry repeated “Lifecycle event” | Recorded lifecycle events only, with neutral event markers |
| Logs | Tab title repeated in an intro; TIME and TIMESTAMP repeated the same event time; toolbar ended with orphan buttons | One time column with full-date title; filters/live on the first row, search/tools on the second |
| Terminal | Target and connection controls describe the current session rather than repeat configuration | Existing terminal controls retained |

Native memory now describes sandbox-scoped notes without claiming the
project-level persistence of Durable Memory. The effective access algorithm,
policy API, runtime capability flags, and provisioning state logic are preserved.
The policy edit entry uses the API's existing
`CAP_AGENT_INSTANCE_ACCESS_POLICY_ASSIGN` capability. Draft selection survives
an update error and resets when the editor is closed/reopened.

### Evidence and limits

- Typecheck and Control production build passed. Frontend suite: 52 files,
  273 tests passed. `git diff --check` passed.
- All six tabs were inspected in light and dark desktop themes, with one page
  heading, no broken images, and no page-level horizontal overflow at the
  observed 1270 CSS-pixel width. Configuration was also measured at 1625 CSS
  pixels without overflow. Exact viewport sizing and browser zoom remain
  unverified because the browser override differs from its requested size.
- Overview resource links retain their destination tabs and section hashes;
  the Memory link was exercised. Arrow navigation focuses a neighboring tab
  without activating it; Enter activates it and updates the URL.
- Policy editing: opening, removing the draft selection, required-selection
  feedback, disabled Apply, cancellation, reopening with the persisted Default
  selection, Escape, and focus restoration were verified. Full instructions
  remain available in their read-only dialog. No policy update was submitted.
- Logs: search produced the empty state, clearing restored entries, wrapping
  toggled in both directions, and only TIME/LEVEL/SOURCE/MESSAGE columns remain.
  Terminal was inspected without entering commands.
- Browser warning/error inspection returned no entries. The unsaved Light
  theme preview was restored to the original System preference.
- Screenshots and DOM measurements are in `output/instance-tabs-review/`:
  `before-*.png`, `after-*.png`, light variants, cropped content images, and
  `browser-audit.json`.
- This Instance has no attached Skills, MCP Servers, or Vector Databases and
  has native memory. Populated attachment lists, API retry, and policy
  mutation success/failure were source-reviewed rather than browser-executed.

### Prototype gate

Subchecks use 0 (unverified), 1 (source-reviewed), and 2 (browser-verified),
normalized to 10. Build/tests support implementation correctness separately.

| Dimension | Subchecks | Score |
| --- | --- | ---: |
| Product intent | Instance inspection 2; shared access entry 2 | 10 |
| Information architecture | Tab ownership 2; compact empty states 2; resource link 2 | 10 |
| Trust and domain fit | Memory scope 2; unchanged capability flags 2; API recovery 1 | 8.33 |
| Interaction readiness | Keyboard 2; draft/cancel/focus 2; mutation success 1; mutation failure 1 | 7.5 |
| System craft | Paired themes 2; overflow 2; exact resize/zoom 0 | 6.67 |
| Visual and brand expression | Shared components/tokens 2; rendered screenshot review 2 | 10 |

Product Console weighted score: **8.83/10**. The read-only inspection path passes
the prototype threshold without blockers. Persisted policy changes and exact
zoom/resize acceptance remain outside the verified evidence for this pass.

## Other Instance kinds — shared tab layout

Extended the detail review to managed A2A, external A2A, Project Agent, OpenClaw,
Deep Agents Code, and Pi, with Hermes regression coverage. Supervisor platforms
share the same route branch; A2A and Project Agent share the service branch.
The target remains desktop administrators inspecting existing runtime Instances.

### Changes

- All kinds now use the same detail header, resource-summary links, and resource
  sections. Service unavailable states use one compact panel. Identity/status and the runtime
  appear in the header once. Removed the service-only profile hero and repeated
  work-mode badges; the shared runtime feature matrix retains the actual flags.
- Service Overview contains description, linked advertised-skill counts, Agent
  Card status, deployment version where applicable, and operating context.
  Full skill descriptions appear in Capabilities only.
- Configuration owns identity, managed deployment evidence, protocol endpoints,
  discovery evidence, and the collapsed normalized protocol JSON. External
  A2A omits the Kubernetes card instead of rendering empty Image/Namespace/
  Workload fields or a hard-coded container name.
- Project Agent has one Agent Developer entry. Its deployed version and digest
  come from the Instance snapshot, rather than the definition's active version.
- Logs no longer repeat a generic title or read-only explanation. Unsupported
  Logs/Terminal links preserve their disabled reasons; direct links show the
  same compact unavailable treatment.
- Rediscover Agent Card opens a right-side operation drawer. Pending blocks
  duplicate requests and dismissal; success/error stay in the drawer, and an
  error leaves the operation available for retry. Existing discovery/removal
  API calls and permission inputs are preserved.
- Activity displays loading and recoverable errors for every Instance kind,
  while retaining available event lines.

### Verification

The two accessible Projects contained one Hermes Instance and no other kinds.
No new runtime resources were created for this review. Other kinds were
rendered through the real components in a separate local fixture origin with
synthetic data, local simulated HTTP/WebSocket responses, and no backend proxy.
The fixture visibly labels its simulated state. It is outside the production
route tree and build inputs.

- Seven fixture scenarios, both light/dark themes: **68 available tab views**.
  Each had one page heading, no broken images, and no document overflow.
- Managed A2A, external A2A, Project Agent, and populated OpenClaw also passed
  **12 narrow-panel views**. The measured panel widths were 990 and 760 CSS
  pixels including padding, without panel overflow. Exact browser zoom is
  still unverified.
- Empty advertised skills, absent protocol, external Logs, unsupported Terminal,
  and permission-restricted Logs retain explicit, compact states. External
  Configuration contains no empty managed-runtime card.
- Rediscovery fixture: open, pending/dismissal lock, success, failure, available
  retry, cancellation, and focus restoration were exercised. Lifecycle failure
  exposed its retry control. These are simulated responses, not production
  discovery or log-backend acceptance.
- Protocol JSON disclosure, summary-to-section navigation, manual keyboard tab
  activation, and Back/Forward were exercised. Project Agent displayed deployed
  v3 even when its fixture definition advertised active v4.
- Real Hermes: all six tabs were rechecked at the observed 1270 CSS-pixel width
  with one heading, no page overflow, and no browser warning/error entries.
  The original Project was restored; no terminal commands were entered.
- Typecheck, 52 frontend test files / 273 tests, production build, and
  `git diff --check` passed.

Evidence is in `output/instance-types-review/`: normal, dark, narrow, empty,
unavailable, and operation-state screenshots; `browser-audit.json`,
`edge-audit.json`, and `live-browser-audit.json`. The fixture source/configuration
snapshots are retained there for reproduction. A clean final fixture tab had
no browser warnings/errors; initial harness setup errors were corrected before
the recorded review.

### Prototype gate

| Dimension | Subchecks (0–2) | Score |
| --- | --- | ---: |
| Product intent | Clear inspection path 2; one resource header/action entry 2 | 10 |
| Information architecture | Tab ownership 2; compact inventory 2; runtime-specific configuration 2 | 10 |
| Trust and domain fit | Deployment snapshot 2; absent protocol truth 2; real service backend acceptance 1 | 8.33 |
| Interaction readiness | Keyboard/history 2; operation pending/success 2; failure/retry 1; unavailable reasons 2 | 8.75 |
| System craft | Paired themes 2; panel overflow 2; exact browser zoom 0 | 6.67 |
| Visual and brand expression | Shared primitives/tokens 2; rendered review 2 | 10 |

Product Console weighted score: **9.03/10**, passing the prototype threshold
without blockers in the inspected paths. Live A2A/Project Agent backend
acceptance and exact browser zoom remain unverified; this is not a deployment
or a release certification.
