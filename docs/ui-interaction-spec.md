# TaskLattice Relay UI and Interaction Specification

Status: Proposed canonical contract

Version: 1.1-draft (angular ToB profile, 2026-09-17)

Scope: Control Plane shell, operational pages, forms, tables, dialogs, sheets,
drawers, status feedback, and responsive behavior.

This document is the single source of truth for cross-product UI and
interaction rules. Product or page-specific specifications may add domain
behavior, copy, roles, and acceptance scenarios, but must not redefine the
visual tokens or common interaction states in this document.

The contract is intentionally implementable with the existing Control Plane
stack. The runtime implementation remains the final check until every rule in
this document has a corresponding token, component, or automated test.

The review method is the Vibe Designing evidence model: design intent becomes
observable constraints, implementation choices, and browser evidence. A visual
preference is not a passing criterion until its user impact and verification
path are clear.

## 1. Product intent

TaskLattice Relay is an operational control plane for declaring, provisioning,
inspecting, and entering isolated Agent runtimes. The UI prioritizes the
operator's next decision and the truth of the current system state over
marketing expression.

The interface must:

- keep desired configuration and observed runtime state separate;
- expose the current owner, status, risk, and next action when they matter;
- never imply that a request, approval, provisioning operation, or runtime
  change succeeded before the relevant system reports success;
- make consequential actions explicit and recoverable; and
- remain scannable when a page contains operational identifiers, metrics,
  statuses, and evidence at the same time.

Target users include requesters, developers, reviewers, operators,
administrators, and auditors. A page must expose only the actions permitted by
the current role and resource scope.

### 1.1 Required page design contract

Every new or substantially changed page specification must state:

| Field | Required decision |
| --- | --- |
| Target user | The role and resource scope being served |
| Primary task | The one action or judgment the page must make easy |
| Page type | Usually `Product Console`, `Data Dashboard`, or `Content / Documentation` |
| Maturity mode | `vibe_draft`, `prototype`, or `release_gate` |
| First-screen priority | What must be visible without scrolling |
| Primary CTA | The specific action label and its destination |
| Non-negotiables | Domain, permission, safety, compliance, and responsive constraints |

The page type determines what “good” means. This system optimizes for
operable tasks, trustworthy state, and scanability in a Product Console; it
does not apply a landing-page or marketing-page visual standard to operational
work.

## 2. Design direction

The product uses a **compact dark-capable operational console** language:

- precise, calm, and direct rather than decorative;
- high information density through hierarchy and structured rows, not tiny
  unreadable text;
- restrained surfaces separated by one-pixel rules and small tonal changes;
- semantic colors reserved for state, risk, and the primary action;
- progressive disclosure for advanced provider, runtime, policy, and evidence
  details; and
- modal, sheet, or drawer surfaces used as focused workspaces when the user is
  inspecting or completing a bounded task.

The attached reference style is a quality reference for density, hierarchy,
surface restraint, semantic feedback, and structured detail. It is not a
requirement to copy its branding, exact colors, or layout.

### 2.1 Reference extraction: compact operation surface

The supplied evidence screenshot defines the following reference profile for a
bounded evidence-upload or resource-operation surface. These are starting
tokens and layout constraints, not sampled production values. They must be
represented through semantic tokens and validated against the rendered page.

#### Visual profile

- Use a near-black canvas, a slightly raised modal/drawer surface, and one
  additional control surface for inputs and file rows.
- Use low-contrast one-pixel borders to separate surfaces. Avoid heavy shadows;
  elevation should primarily communicate overlay ownership.
- Reserve the strongest accent for the primary action, upload affordance, and
  active/focused controls.
- Use muted secondary text for context and metadata rather than making every
  line equally bright.

#### Reference palette

| Reference token | Approximate value | Intended role |
| --- | --- | --- |
| `reference-canvas` | `#191919` | Dark page background |
| `reference-surface-modal` | `#151518` | Operation surface |
| `reference-surface-control` | `#1D1C22` | Inputs, selectors, file rows |
| `reference-surface-accent` | `#25203F` | Upload/dropzone emphasis |
| `reference-border-subtle` | `#302F38` | Boundaries and dividers |
| `reference-text-primary` | `#F2F1F5` | Titles, values, primary content |
| `reference-text-secondary` | `#A29FAA` | Labels and supporting copy |
| `reference-text-muted` | `#686570` | Metadata and helper text |
| `reference-accent-primary` | `#7B68EE` | Primary action and active control |
| `reference-accent-link` | `#B09DFF` | Links and file-type affordances |
| `reference-success` | `#49C96A` | Completed or verified state |
| `reference-success-surface` | `#12351E` | Success badge background |
| `reference-danger` | `#FF5151` | Failure or destructive state |
| `reference-danger-surface` | `#3A171A` | Danger badge/background |

These reference colors must map to the product's semantic roles. Do not mix a
purple reference primary with the existing cobalt primary on the same surface
without an explicit theme decision.

#### Reference type and density

Assuming the supplied image is a 2× design export, use these approximate CSS
values:

| Element | Size / rhythm |
| --- | --- |
| Operation-surface title | 24–26 / 32 px, weight 600–700 |
| Body and control text | 15–16 / 22–24 px, weight 400–500 |
| Field label | 14 / 20 px, weight 500 |
| Metadata | 12–13 / 18 px, weight 400 |
| Control height | 48–52 px |
| Resource/file row | 56–64 px |
| Group gap | 20–24 px |
| Control gap | 8–12 px |
| Desktop inner padding | 24–32 px |
| Mobile inner padding | 16 px |
| Observed control radius | approximately 10 px; reference only, normalize to the 2 px ToB core token |
| Observed grouped-panel radius | approximately 14 px; reference only, normalize to the 4 px ToB core token |

This is `compact productive density`: fit more decisions into one viewport
without reducing body text below a readable size. Density comes from grouped
label/value structures, two-line resource rows, compact spacing, and clear
surface hierarchy—not from shrinking every font.

#### Reference operation-surface structure

Use this order for evidence upload and similar bounded operations:

```text
Operation Surface
├── Header: title, context, close
├── Body
│   ├── Resource/control selector
│   ├── Upload or primary input area
│   ├── Existing items with state and progress
│   ├── Description or justification
│   └── Secondary date/policy fields
└── Footer: cancel and specific primary action
```

The header, body, and footer are distinct regions. The footer uses a top
divider, keeps the primary action visually dominant, and remains visible while
the body scrolls. File or resource rows show the name, secondary metadata,
state label, progress where applicable, and a separate remove affordance.

The screenshot shows a centered wide task modal. For this product, the same
content structure must be adapted to the right-side operation drawer required
by §6.5 whenever the operation has a side effect. The screenshot is therefore
a reference for content density and surface craft, not for mutation placement.

### 2.2 Reference extraction: analytics control dashboard

The supplied analytics screenshot defines a second reference mode: a
light-surface dashboard for scanning, comparing, and then investigating
operational data. It belongs to the same product family as §2.1, but its
density is horizontal rather than form-driven.

#### Dashboard intent and scan order

The dashboard supports this sequence:

```text
Orient → Filter → Compare KPIs → Inspect trend → Investigate breakdown
```

Use this information order:

1. Persistent shell and current workspace context.
2. Page title and time/filter controls.
3. A row of comparable KPI cards.
4. One primary trend or activity visualization.
5. Secondary breakdowns, rankings, geographic or request lists.

The first viewport must make the page purpose, current time range, primary
metrics, and the next investigation path understandable without opening a
menu. A dashboard is not a collection of decorative cards: every module must
answer a distinct operational question.

#### Visual profile

- Use a light working canvas, white panels, quiet gray borders, and dark text.
- Keep the outer blurred or gradient background, if present in a showcase
  composition, outside the product workspace; it is not part of the console
  surface contract.
- Use a persistent left navigation around 220–240 px wide and a compact top
  bar around 52–56 px high on desktop.
- Use four equal KPI cards when the metrics are genuinely comparable. Use a
  full-width primary chart below them and a three-column secondary row only
  when each panel has a distinct question.
- Use a 4 px core panel radius, one-pixel borders, and 16–20 px panel
  padding. Softer screenshot geometry is reference material, not a product
  variant.
  Do not add heavy shadows to every card.

#### Reference palette and data color

These are approximate reference values extracted from the screenshot. They
must map to semantic tokens and must not be copied as unstructured literals.

| Reference token | Approximate value | Intended role |
| --- | --- | --- |
| `dashboard-canvas` | `#F7F7F8` | Light page background |
| `dashboard-surface` | `#FFFFFF` | Cards, charts, lists |
| `dashboard-border` | `#E6E6EA` | Card boundaries and dividers |
| `dashboard-text-primary` | `#1F1F22` | Titles, metrics, primary values |
| `dashboard-text-secondary` | `#77777F` | Labels, axis text, metadata |
| `dashboard-text-muted` | `#A2A2A8` | Disabled or low-priority context |
| `dashboard-success` | `#16C784` | Positive usage or healthy metric |
| `dashboard-warning` | `#F59E0B` | Activity, attention, or threshold |
| `dashboard-info` | `#3B82F6` | Efficiency, informational series |
| `dashboard-accent` | `#A855F7` | Brand emphasis or selected control |
| `dashboard-action` | `#151515` | High-contrast download or export action |
| `dashboard-chart-neutral` | `#4A4A4D` | Neutral comparison series |
| `dashboard-chart-grid` | `#ECECEF` | Chart grid and reference lines |

Use no more than four to six active hues in one dashboard viewport unless
the data domain requires more categories. Every hue must have a stable legend,
label, or semantic meaning. Use neutral gray for secondary series rather than
adding a new accent for every dataset.

The dashboard may be more colorful than the operation surface because charts
need parallel visual channels. This is **semantic chromatic density**, not a
license for decorative saturation across navigation, cards, or background
surfaces. Do not mix the screenshot's purple accent with the product's cobalt
primary without an explicit theme decision.

#### Reference typography and density

| Element | Approximate CSS value | Use |
| --- | --- | --- |
| Page title | 24–28 / 32 px, weight 600–700 | Workspace identity |
| KPI label | 12–13 / 18 px, weight 500 | Metric name and unit |
| KPI value | 32–40 / 40–48 px, weight 600–700 | Primary comparison value |
| KPI supporting value | 12–13 / 18 px | Goal, denominator, or period |
| Chart title | 14–16 / 20–24 px, weight 600 | Panel identity |
| Axis and legend text | 11–12 / 16 px | Chart annotation |
| Navigation text | 12–13 / 18 px | Persistent shell |
| Panel gap | 16–20 px | Grid rhythm |
| Section gap | 20–24 px | Hierarchy between dashboard bands |
| Page padding | 24–32 px desktop, 16 px mobile | Workspace breathing room |

This mode is `high horizontal density, moderate vertical density`: multiple
modules share the viewport, but each module retains readable labels, chart
legends, and actionable whitespace. Do not increase density by shrinking axis
labels or KPI values below their readable role.

#### Dashboard interaction contract

- Time ranges, tabs, group-by controls, and filters may update query or view
  state inline or through a popover; they are non-mutating controls and do not
  require an operation drawer.
- Hover and keyboard focus on chart marks expose a readable tooltip containing
  the date/category, series name, exact value, and relevant unit.
- Legends and series toggles must visibly change the chart and announce the
  selected state.
- Download/export actions must identify the data scope and current filters.
  They may remain inline when they only produce a client download; a persisted
  configuration or external resource change follows §6.5.
- Selecting a KPI, chart mark, or list row must either expose detail, update a
  filter, or navigate to a known investigation path. Decorative clicks are
  not allowed.
- Charts require loading, empty/zero-data, stale-data, error, and
  unavailable-series states. A blank chart is not an acceptable empty state.
- A dashboard must preserve the selected time range and filters when moving
  into a detail view, unless the user explicitly resets them.

The analytics screenshot is therefore a reference for dashboard composition,
cross-module comparison, and semantic color channels. It does not override the
right-side operation-drawer rule for side-effecting changes.

## 3. Source of truth and precedence

When rules conflict, apply this order:

1. Safety, permission, domain truth, and accessibility requirements.
2. This document's shared tokens and interaction rules.
3. The relevant page or domain specification.
4. Existing component behavior and local implementation detail.

The current implementation uses `Inter` for interface and display text,
`Noto Sans SC` / `Noto Sans TC` for CJK fallback, and `Chivo Mono` for
technical values. The previous `Hanken Grotesk` / `Noto Serif SC` proposal is
retired; it must not be reintroduced by a page-level document.

The code-level token implementation is in
`apps/control/src/styles.css`. The typography contract test is in
`apps/control/src/styles.typography.test.ts`. A documentation change that
changes a token or font role must update both the implementation and its test.

## 4. Visual system

### 4.1 Color roles

Use semantic tokens rather than page-specific literal colors.

| Role | Meaning | Usage |
| --- | --- | --- |
| Primary / cobalt-indigo | Main interactive brand action | Primary buttons, selected navigation, links, focus |
| Info / blue | Informational state | Neutral system information and links when not an action |
| Success / green | Verified or completed | Match, healthy, enabled, applied |
| Warning / amber | Attention or incomplete trust | Pending, limited, not anchored, needs review |
| Danger / red | Failure or destructive risk | Failed, mismatch, blocked, destructive confirmation |
| Foreground | Primary readable content | Titles, values, actions |
| Muted foreground | Secondary context | Labels, metadata, helper copy |

Color is never the only status signal. Pair it with text, an icon, a shape,
position, or a state label.

Light mode uses a cool gray canvas, white working surfaces, and a slightly
darker sidebar. Dark mode uses a deep navy canvas with raised navy surfaces.
Boundaries use cool-gray one-pixel rules. Shadows are limited to raised
controls and overlays; do not use glow, ambient gradients, or indiscriminate
blur.

Purple or other accent colors may be used only when represented by the
primary-interactive token or an explicitly documented product accent. Never
use an ambient purple-blue gradient as decoration.

#### 4.1.1 Canonical product palette

The current system's primary color is **cobalt-indigo**, not the purple used
in the supplied reference screenshot. These are the implementation values in
`apps/control/src/styles.css`:

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--primary` | `#4F5FD7` | `#5668D8` | Primary action and selected interaction |
| `--primary-hover` | `#4050C5` | `#5A6BD9` | Hover |
| `--primary-active` | `#3442AD` | `#4959C4` | Pressed/active |
| `--primary-surface` | `#EEF1FF` | `#222D55` | Soft selected surface |
| `--primary-border` | `#CBD3FF` | `#4656AA` | Primary boundary |
| `--ring` | `#4F5FD7` | `#7D8CF3` | Keyboard focus |
| `--link` | `#4057C7` | `#9AA7FF` | Text link |

Supporting semantic roles are green for success, amber for warning, blue for
information, and red for danger. Chart-specific series may use additional
colors only when they have a legend or stable data meaning.

The screenshot reference purple (`#7B68EE` / `#A855F7`) is a visual reference
only. It must not replace the product primary or be mixed with cobalt on the
same surface without an explicit theme decision.

### 4.2 Typography

Typography is an information hierarchy, not a decorative theme. Assign fonts
by semantic role rather than by HTML heading level.

| Role | Family | Use | Allowed weights |
| --- | --- | --- | --- |
| Interface | `Inter`, then `Noto Sans SC` / `Noto Sans TC` and platform sans fallbacks | Navigation, body copy, controls, section headings, cards, dialogs, sheets, tables, statuses, metrics | 400, 500, 600, 700 |
| Display | Same interface family | Page or entity identity where a display treatment is intentionally selected | 400, 500, 600 |
| Technical | `Chivo Mono`, then platform monospace fallbacks | IDs, permissions, endpoints, routes, model names, hashes, logs, YAML, code, machine values | 400, 500 |

Semantic rules:

- `font-sans` is the default for operational UI.
- `font-display` is opt-in for page or entity identity; never infer it from
  `h1`, `h2`, or `h3`.
- `font-mono` is required for system-produced or system-consumed strings.
  Native `code`, `kbd`, `samp`, and `pre` elements inherit it automatically.
- Use tabular numerals for changing or vertically compared metrics, money,
  durations, counts, versions, and timestamps.
- Use 400 for body copy, 500 for values and compact emphasis, 600 for
  operational headings and actions, and 700 only for strong identity accents.
- Avoid uppercase body copy. Uppercase is reserved for short labels or
  technical markers with deliberate tracking.
- CJK text must retain readable glyph fallback and must not depend on a Latin
  font's missing glyph substitution.

Font loading must keep the supplied license files with redistributed font
software. Load Latin subsets for `Inter` and `Chivo Mono`, and use the
unicode-ranged variable CJK assets so visible Chinese glyphs do not require
shipping an unnecessarily large family to every page.

### 4.3 Type scale and density

The following scale is the default starting point. A component may use a
smaller size for metadata only when contrast, line height, and scanability
remain intact.

| Token | Size / line height | Default use |
| --- | --- | --- |
| `text-xs` | 12 / 18 px | Metadata, helper text, compact labels |
| `text-sm` | 14 / 20 px | Body copy, controls, table cells, form values |
| `text-base` | 16 / 24 px | Long-form body copy and prominent values |
| `text-lg` | 18 / 27 px | Section headings |
| `text-xl` | 20 / 28 px | Entity or page subheading |
| `text-2xl` | 24 / 32 px | Page title |
| Technical compact | 12–13 / 18–20 px | IDs, hashes, logs, machine values |

Desktop console pages should prefer compact rows and structured label/value
groups. Mobile pages must preserve readable text and 44 px touch targets even
when that increases vertical height.

### 4.4 Spacing, shape, and surfaces

Use a 4 px base rhythm, with 8, 12, 16, 20, 24, and 32 px as the common
steps. Prefer fewer, deliberate spacing values over arbitrary local numbers.

- The default ToB control radius is 2 px: a near-square rectangle, not a
  visibly soft rounded control. Structural surfaces, tables, and viewport-aligned
  drawers use 0 px. Cards and floating menus/dialogs use 4 px maximum.
- This angular profile supersedes the earlier 6 / 8 / 12 px profile and the
  softer geometry in the reference screenshots (decision: 2026-09-17).
- Login inputs, sign-in buttons, SSO buttons, alerts, and language controls use
  the 2 px near-square token by default.
- Do not add a large rounded container around the login form unless it has a
  documented layout or trust purpose.
- Rectangular status badges use 2 px. Circles remain appropriate for avatars,
  radio controls, status dots, and switch mechanics; they do not justify pill
  buttons, tabs, inputs, or cards.
- Use one-pixel borders to clarify ownership and grouping.
- Panel padding is normally 20–24 px on desktop and 16 px on mobile.
- A label/value row normally uses 12–16 px vertical padding and a one-pixel
  divider when multiple rows form a scannable group.
- Use elevation to indicate layering, not to decorate every card.

### 4.5 Token layers and motion

The system is maintained in layers:

1. Visual intent: operational temperament, density, neutral temperature, and
   language priority.
2. Semantic roles: primary action, link, surface, border, chart, success,
   warning, danger, and information.
3. Value tokens: color, type, spacing, shape, elevation, motion, z-index, and
   light/dark theme mapping.
4. Component derivation: hover, active, selected, disabled, loading, error,
   and responsive variants derived from those roles.
5. Enforcement: shared component tokens, tests, browser checks, and an
   explicit record of known gaps.

Use semantic stacking layers rather than arbitrary page-local z-index values:

| Layer | Responsibility |
| --- | --- |
| Base | Normal document content |
| Sticky | Persistent headers, table headers, and action bars |
| Dropdown | Menus, comboboxes, and contextual popovers |
| Overlay | Drawer backdrop and navigation overlay |
| Modal | Dialogs, sheets, and operation drawers |
| Toast | Non-blocking global feedback above modal surfaces |

Motion is feedback or spatial orientation, never decoration. Keep routine
transitions at or below 300 ms, animate `transform` and `opacity` by default,
avoid layout-triggering animation, and ensure the same state change remains
understandable with `prefers-reduced-motion` enabled.

### 4.6 Login and trust-boundary profile

The login page is a trust boundary and should feel deliberate, stable, and
platform-like rather than like a promotional card. Its default geometry uses
near-square controls within a clearly aligned composition:

- The desktop split layout and its divider have no outer card radius.
- The form does not sit inside an additional floating rounded card by default.
- Inputs, password visibility controls, sign-in, SSO, alerts, and language
  controls use 2 px radius; dividers and structural edges use 0 px.
- The primary sign-in button is a filled rectangle with restrained radius,
  never a capsule or pill.
- The login surface uses one-pixel boundaries, clear alignment, compact
  spacing, and strong type hierarchy to provide hardness; radius alone is not
  the source of authority.
- Error, development-default, loading, disabled, and successful redirect
  states must preserve the same geometry and must not cause layout jumps.

## 5. Information architecture

### 5.1 Global shell

Desktop navigation is persistent and can collapse from 280 px to 72 px. The
collapsed state retains accessible names and tooltips and persists locally.
The active item uses surface, weight, and an accent rule; color alone is not
the active-state signal.

Mobile navigation is a dismissible overlay drawer. It opens from the menu
button and closes through its close button, backdrop click, navigation,
or `Escape`. Dismissal returns the page to an unobstructed state.

The account control stays at the bottom of navigation. The top bar contains
route context and environment context. Future or unavailable sections are
visibly disabled, labeled `Later`, and explain their relationship to the
current product path; they are not fake links.

### 5.2 Page hierarchy

Every page begins with one shared `PageHeader`:

1. page-specific `h1`, optionally paired with a status badge;
2. concise task or scope description when useful; and
3. page-level actions aligned with the title block.

The breadcrumb belongs to the application shell and is not repeated as an
eyebrow above the page title. `PageHeader` owns `title`, `description`,
`badge`, and `actions`; route hierarchy must not drift between shell and body.

### 5.3 Dense operational content

Use tables, label/value rows, timelines, compact lists, and expandable groups
when users compare or diagnose operational data. Keep stable identifiers,
status, current step, and responsible owner visible; truncate only secondary
long names.

Do not turn every item into an equal-weight card. Group related values inside a
panel, use section lines to establish hierarchy, and reserve a strong accent
for the primary action or the most important state.

When content grows, use pagination, filtering, or virtualization instead of
making the initial viewport an unbounded list.

## 6. Interaction model

### 6.1 Progressive disclosure

The first view contains the minimum decisions needed for the primary task.
Advanced configuration, provider details, permissions, raw records, and
diagnostic evidence appear in expandable sections, a detail panel, or a
secondary surface. Disclosure must not hide a failure, permission boundary,
current owner, or required confirmation.

### 6.2 Common component state contract

Every interactive component must define the applicable states below:

| State | Required behavior |
| --- | --- |
| Default | Purpose and available action are understandable |
| Hover | Pointer feedback without changing meaning |
| Focus-visible | Clear keyboard focus indicator, not color alone |
| Active / selected | Persistent visual and semantic selection |
| Loading | Prevent duplicate action and preserve layout |
| Success | State change, result, and next action are visible |
| Empty | Explain the absence and offer a useful next step |
| Error | State what failed, what changed, and whether retry is safe |
| Disabled | Explain why unavailable when the reason is not obvious |
| Recovery | Provide retry, edit, cancel, or an appropriate alternative |

No control may look actionable while being disconnected from an outcome.

### 6.3 Forms

- Use labels associated with controls and describe constraints before submit.
- Show only fields relevant to the selected resource or request type.
- Preserve input after validation or backend errors.
- Place the primary action at the end of the decision sequence and give it a
  specific verb, such as `Submit for Approval`, `Create Agent`, or `Load Skill`.
- Use `Save Draft` only when draft semantics are real; a preview must say that
  content exists only in the current session.
- Long forms use a persistent action area with `Cancel`, a secondary action,
  and one primary action. On mobile it must not cover the last field.

### 6.4 Dialogs, sheets, and drawers

Use the smallest surface that supports the task:

- Dialog: confirmation, short decision, or focused summary.
- Sheet: bounded create/edit task with several fields or a preview.
- Drawer: contextual detail or mobile navigation.
- Full page: multi-step work, high-volume data, or content that users need to
  bookmark, compare, or revisit.

Every modal surface must have a title, clear close behavior, focus trapping,
focus restoration, Escape handling, a visible boundary, and a scroll region
that does not hide the action area. Do not stack unrelated modal surfaces.

An inspector surface should place identity and status in the header, the
highest-risk or highest-value explanation first, structured details next, and
related records or secondary actions last. A task sheet should place context,
form, upload/progress feedback, optional metadata, and action footer in that
order.

### 6.5 Side-effect boundary and resource actions

All side-effecting changes must begin in a right-side operation drawer on
desktop. This applies to create, update, delete, revoke, enable, disable,
retry, restart, reload, approval, and any other action that changes persisted
state, runtime state, permissions, or external resources.

The operation drawer is the consistent boundary between inspection and
mutation:

- Read-only details may appear inline, in a detail panel, or in an inspector
  drawer.
- A read-only surface must not contain an inline control that silently changes
  state.
- The operation drawer contains the resource identity, current status, impact
  or policy context, the required fields, validation feedback, and an explicit
  action footer.
- The primary action names the operation, such as `Update Policy`, `Delete
  Project`, `Restart Agent`, or `Revoke Grant`.
- The drawer remains open while the operation is loading, reports success or
  failure in context, and provides the applicable recovery action.
- High-impact operations still require an explicit confirmation step inside
  the operation flow. The drawer rule does not replace confirmation.

On narrow viewports, the right-side drawer becomes a full-height, full-width
operation sheet while preserving the same information order, focus behavior,
action footer, and state semantics. It must not become an unscoped inline
mutation.

#### More-actions menu

Single-resource secondary operations are exposed through a three-dot
`More actions` trigger. The trigger opens a menu; selecting a menu item opens
the right-side operation drawer and does not execute the side effect directly.

Rules for the menu:

- The trigger has an accessible name that identifies the resource, for example
  `More actions for Project Alpha`.
- Menu items are derived from the resource type, current state, user role, and
  permission scope. Different objects may expose different actions.
- Typical actions include `Update`, `Delete`, `Restart`, `Revoke`, `Enable`,
  and `Disable`, but pages must not show actions that are invalid for the
  resource's current state.
- Destructive actions use an explicit label and danger treatment and open a
  drawer with impact details and confirmation.
- Unauthorized actions are hidden or disabled with an explanation according
  to the permission model; they must never fail silently after selection.
- The menu uses standard keyboard behavior, visible focus, and closes when an
  action is selected, cancelled, or the user presses `Escape`.
- A resource row may expose one clearly identified primary action separately;
  all other resource mutations belong in `More actions`.

### 6.6 Async operations and truthfulness

- Do not flash a loader for work expected to finish within 300 ms.
- From 300 ms to 2 s, retain the layout and show stable progress or a
  placeholder.
- After 2 s, identify the object and operation being processed.
- After 10 s, provide Retry or another explicit recovery path.
- Do not announce success before the relevant API, runtime, or durable store
  confirms success.
- Distinguish `Approved`, `Change applied`, and `Completed`.
- Distinguish desired state from observed runtime state.
- A failed operation must say whether the previous known-good state remains.

### 6.7 Permissions and consequential actions

Navigation and actions reflect the user's actual scope. A read-only user may
still inspect the same detail surface but must not see fabricated mutation
controls.

Confirmation is required for destructive or interrupting actions, including
revoking access, stopping or deleting an Agent, unloading a required Skill,
retrying an operation that can interrupt runtime, or suspending an offering.
Confirmation names the resource and impact. Typing the resource name is
reserved for irreversible deletion.

## 7. Responsive and accessibility contract

- Use semantic HTML, logical DOM order, and meaningful landmarks.
- Support full keyboard operation and visible `focus-visible` states.
- Keep touch targets at least 44 × 44 CSS px where touch interaction applies.
- Associate labels, descriptions, errors, and status announcements with their
  controls.
- Dialog focus is trapped and restored correctly.
- Status is never conveyed by color alone.
- Tables have accessible names and a usable narrow-screen fallback.
- Mobile uses a single-column order: header, tabs or filters, primary content,
  then summary/details.
- No page may introduce horizontal overflow at a 390 px viewport.
- Honor `prefers-reduced-motion`; animate opacity and transform by default.
- Keep routine transitions under 300 ms.
- Target WCAG 2.2 AA.

## 8. Domain invariants for product specs

Page-level specifications must preserve these invariants:

- approval is not proof of deployment or runtime activation;
- pending, approved, applied, completed, rejected, and failed are distinct
  states;
- audit history explains evidence for the selected resource and does not
  silently become a global audit view;
- preview data is labeled as preview and never presented as persisted state;
- credentials, tokens, and raw sensitive configuration never appear in
  summaries or browser-visible diagnostics; and
- user-facing language uses domain terms consistently and does not expose
  internal workflow names when a user-facing term exists.

For Approval, the canonical product flow is: `Raise Request` → `Pending
review` → decision → optional application → `Completed` or `Failed`. The
request detail must always expose status, current step, current owner, and
whether the requested change has actually taken effect.

## 9. Implementation contract

Shared components and tokens are preferred over page-local utility strings.
Add a token or component variant when the system lacks one; do not scatter
literal colors, radii, or one-off state behavior through route files.

At minimum, the shared system should provide variants for:

- primary, secondary, ghost, destructive, and disabled buttons;
- info, success, warning, danger, and neutral status badges/alerts;
- dense label/value rows and semantic data tables;
- page headers with status and action slots;
- dialogs, sheets, drawers, and mobile navigation;
- resource-scoped `More actions` menus that dispatch to a right-side operation
  drawer;
- operation-drawer variants driven by resource type, state, role, and
  permission scope;
- loading, empty, error, and retry surfaces; and
- visible keyboard focus and reduced-motion behavior.

The current code-level baseline is:

- `Inter` / CJK sans fallback / `Chivo Mono` font roles;
- semantic CSS variables for surfaces, borders, primary, info, success,
  warning, danger, sidebar, and radius;
- shared Button, Badge, Select, Tabs, Sidebar, Dialog, and Sheet primitives;
  and
- a typography test that prevents heading-level font-family drift.

Implemented alignment (reapplied with angular profile, 2026-09-17):

- Shared controls use 2 px radii, panels/cards 4 px, and large floating surfaces
  4 px. Login controls are near-square. Viewport-aligned
  drawers keep square outer edges.
- Shared page titles use 24 px semibold type; operational detail/state headings
  use the same weight. The workspace top bar is 56 px high and standard page
  padding is 24 px desktop / 16 px mobile.
- Vector file new-folder, rename, move, and delete use right-side EntitySheet
  surfaces. Permanent deletion uses the existing name-confirmation component.
  Metadata editing keeps its action footer outside the scrolling body.
- Memory rename/delete already use EntitySheet. Binding, detaching, provider
  recovery, and retain-event replay now require an explicit drawer action.
- Provider revalidation opens a drawer with pending, error, and retry feedback.
- Shared resource menus identify their target in the accessible name; shared
  sheets restore focus to the opening control, including a menu's trigger.
- Narrow right-side sheets fill the viewport. Coarse-pointer controls retain
  44 px targets; reduced-motion preferences suppress decorative transitions.

Known migration and verification gaps:

- This pass restores the shared system and the named file, Memory, and Provider
  operation paths above. It does not certify every historical page-local
  mutation as migrated; remaining actions must be audited against §6.

- Stacking is currently expressed partly through local utility values. New
  work must follow the semantic layer model in §4.5; centralizing z-index
  tokens is a follow-up implementation task.
- Provider-dependent operations still require integration verification with
  configured models, storage, and runtime services. Component-fixture success
  is not evidence that an external operation completed.

For repeatable local interaction review, run
`npm run dev:ui-review --workspace @tali/control` and open `/ui-review.html` on
the review server. This development-only entry renders the actual shared and
file-operation components, with explicitly simulated responses and no API
calls. Exercise menu dispatch, Escape/focus return, pending duplicate-submit
prevention, error/input preservation, retry, name-confirmed deletion, and
desktop/mobile light/dark presentation.

This list is deliberate gap reporting, not permission to add more exceptions.

### 9.1 Angular-profile verification — 2026-09-17

Review scope: the shared visual system, login, and the migrated operation
components above. Review mode: `prototype`, not whole-product release approval.

- TypeScript passed; the frontend suite passed 50 files / 224 tests, including
  a regression assertion for the angular shape tokens.
- The production build passed. No deployment or commit was performed.
- Real login rendered at desktop and 390 px mobile widths. Computed input
  corners were 2 px and the form heading was 24 px; no horizontal overflow.
- Local login and role selection reached the real Project Overview. Its
  mobile navigation opened and closed, restoring the navigation trigger.
- Actual operation components were exercised in the isolated development
  fixture: right-aligned desktop drawer, full-width 390 px mobile drawer,
  light/dark states, initial focus, Escape-to-menu-trigger focus restoration,
  disabled input/submit/close while pending, retained input after a simulated
  failure, and visible success after retry. No resource API writes occurred.
- Delete remained disabled until the exact resource name was entered. The
  review canceled the drawer without executing deletion.
- Viewport and full-page captures were inspected in the review session.
  The fixture console had no warnings/errors at inspection time.
- The fixture uses a separate Vite cache directory. Sharing the main site's
  cache caused a local chart-module load failure; isolation plus restarting
  the main dev server restored the Project Overview.

Evidence-based subchecks (each item is scored 0–2):

| Dimension | Subchecks and evidence | Score / 10 |
| --- | --- | ---: |
| Product Intent | Explicit operation CTA 2; resource identity/impact 2 | 10 |
| Information Architecture | Menu-to-drawer sequence 2; fixed footer 2; mobile layout 2 | 10 |
| System Craft | Shape tokens 2; type hierarchy 2; touch coverage 1; reduced-motion coverage 1 | 7.5 |
| Trust & Domain Fit | Deletion confirmation 2; simulated data identified 2; external outcome verification 1 | 8.33 |
| Interaction Readiness | Focus return 2; pending guard 2; error/retry 2; provider integration 1 | 8.75 |
| Visual & Brand Expression | Neutral surfaces 2; semantic accent 2; angular profile 2 | 10 |

Weighted Product Console score: **9.15 / 10 for this prototype scope**.
Partial checks are not promoted to passes: touch hardware, reduced-motion
rendering, and configured provider/storage/runtime mutations still need
integration evidence. A pre-existing login SSR/client language mismatch was
also observed; this pass does not claim a console-error-free release gate.

## 10. Craft rules and anti-pattern gates

Subjective concerns must be translated into an observable rule and an
acceptance check.

| Risk | Rule | Evidence |
| --- | --- | --- |
| Universal purple-blue gradient | Give accent color a semantic role; reserve strong color for primary actions and critical state nouns | The primary action and critical states remain visually dominant without counting decorative accents |
| Glass or blur everywhere | Reserve translucency for true overlays or spatial layers | Every translucent material has a named layering responsibility |
| Equal rounded cards | Express priority through type, spacing, density, section lines, and asymmetric emphasis where useful | The primary task is identifiable in a five-second scan |
| Default font stack | Define language-aware roles, readable line height, and a deliberate type scale | Mixed-language labels, wrapping, and weight render consistently |
| Decorative motion | Every transition communicates feedback or spatial movement | The action remains understandable with reduced motion enabled |
| Repeated uppercase eyebrows | Use one route-context breadcrumb and meaningful page titles | No repeated context label competes with the page title |
| Emoji as product iconography | Use the established icon system or an official vendor asset | Icons have a stable meaning and accessible name |
| Excessive pills | Use pills for compact status only, not for every label, card, or action | Status badges remain distinguishable from controls |

Do not solve a hierarchy problem with decoration. First adjust information
order, type, spacing, density, or surface ownership; add a visual accent only
when it has a documented product or state role.

## 11. Verification and definition of done

A UI change is complete only when:

1. The relevant domain behavior and permissions are documented.
2. Default, hover, focus-visible, active, loading, success, empty, error,
   disabled, and recovery states are implemented or explicitly marked as a
   known gap.
3. Unit tests, type checking, and the production build pass.
4. Desktop and mobile rendering are inspected, including a 390 px viewport.
5. There is no horizontal overflow, clipped content, unreadable text, broken
   asset, unnamed control, or small touch target.
6. The primary path and at least one failure/recovery path produce visible
   feedback.
7. Browser console errors and missing first-party assets are absent.
8. A release change has evidence for the applicable API, auth, permission,
   and runtime truthfulness checks.

Block release regardless of visual score when the primary task is broken,
state is misleading, a permission boundary is bypassed, controls are
disconnected, or the page cannot be operated accessibly.

## 12. Review gate and evidence model

### 12.1 Six dimensions

Each review records evidence, deduction reasons, and recommendations before
calculating a score. Score every applicable subcheck from 0 to 2:
`2 = pass`, `1 = partial`, `0 = fail`. A critical failure is recorded as a
blocker even if the average score passes.

| Dimension | Verify |
| --- | --- |
| Product Intent | Value, target user, primary task, tone, first-screen priority, and CTA match the real goal |
| Information Architecture | Hierarchy, grouping, order, density, rhythm, navigation, and responsive mental model make the task findable |
| System Craft | Type, spacing, surfaces, radius, elevation, components, states, and desktop rendering behave as one system |
| Trust & Domain Fit | Terminology, data claims, permissions, risk, compliance, AI confidence, and evidence are credible |
| Interaction Readiness | The primary path is understandable, responsive, recoverable, and visibly connected to state changes |
| Visual & Brand Expression | Color, typography, composition, and motion create a category-appropriate expression |

For each dimension:

`dimension_score = sum(subcheck scores) / sum(subcheck maximums) × 10`

### 12.2 Product Console weights

The default weights for this product are:

| Dimension | Weight |
| --- | ---: |
| Product Intent | 22% |
| Information Architecture | 22% |
| Trust & Domain Fit | 18% |
| Interaction Readiness | 16% |
| System Craft | 14% |
| Visual & Brand Expression | 8% |

Do not apply the visual standard for a brand landing page to a control-plane
screen. Operational pages prioritize task clarity, state truth, and recovery.

### 12.3 Review modes

| Mode | Stage | Threshold | Gate behavior |
| --- | --- | ---: | --- |
| `vibe_draft` | Direction exploration | 7.5 | Prioritize intent, IA, brand expression, and craft; missing integrations may remain notes if they do not invalidate the concept |
| `prototype` | Path demonstration | 8.0 | Simulated data is allowed, but the primary path and visible state changes are required |
| `release_gate` | Delivery acceptance | 8.0 | Require production paths, navigation, data, accessibility, responsive behavior, and key states |

The current Control Plane work uses `prototype` while behavior is being
demonstrated and `release_gate` before deployment. The mode changes blocker
severity, not the scoring model.

### 12.4 Evidence stack

Use all applicable evidence layers:

1. **DOM/CSS QA** — overflow, clipping, contrast, fixed positioning, target
   size, accessible names, and broken images.
2. **Page profile** — routes, sections, links, labels, page title, first-screen
   priority, CTA, and interactive targets.
3. **Click smoke** — console/page errors, visible state changes, drawer/menu
   behavior, connected controls, and recovery paths.
4. **Screenshots** — desktop viewport, full page, and mobile viewport when
   responsive behavior is in scope.

Screenshot evidence wins when it conflicts with DOM intent: the rendered result
is what users experience. Visual review must explicitly inspect readability,
hierarchy, composition risk, brand-tone fit, and motion purpose.

### 12.5 Blockers and iteration

The following are independent blockers:

- `unclear_primary_task`
- `critical_rendering_failure`
- `primary_visual_blocks_information`
- `wrong_domain_logic`
- `broken_key_task_path`
- `operation_flow_has_dead_end`
- `disconnected_controls_or_states`
- `untrustworthy_ai_response`
- `brand_tone_mismatch`
- `placeholder_or_missing_conversion_paths`
- `generic_template_output`
- `inconsistent_design_system`
- `subcheck_evidence_missing`
- `screenshot_review_missing`
- `critical_subcheck_failure`

When the review does not pass, return no more than three prioritized
instructions. Each instruction must use this form:

`Evidence → affected dimension → user impact → exact change → verification path`

Do not use non-executable requests such as “polish the UI” or “improve the
interaction.” Re-run the same evidence path after each revision and stop when
the threshold passes without blockers, the iteration limit is reached, or a
revision regresses the best result.

## 13. Document maintenance

This specification owns shared UI and interaction rules. Update it first when
changing fonts, tokens, component states, modal behavior, navigation behavior,
responsive rules, or accessibility requirements.

`docs/interaction-design.md` remains the Marketplace information architecture
and domain direction. `docs/design/approval-interaction-spec.md` remains the
Approval page's detailed flow and acceptance record. They may specialize this
contract but must link back here when they describe shared behavior.
