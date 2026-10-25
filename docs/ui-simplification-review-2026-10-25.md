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
