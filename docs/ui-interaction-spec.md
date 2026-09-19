# TaskLattice Relay UI and Interaction Specification

Status: Canonical design target; implementation partially aligned (see §9)

Version: 1.3 (Tali family alignment; desktop-only scope, 2026-09-19)

Scope: Authentication, Control Plane shell, operational pages, forms, tables,
dialogs, sheets, drawers, status feedback, light/dark themes, and desktop window layouts.

**Platform scope: desktop Web only, across the entire Relay project.** Mobile
and tablet access are not product requirements. Do not propose mobile designs,
add mobile-specific work, or require mobile/touch acceptance unless the user
explicitly changes this scope. Existing responsive fallbacks may remain; they
do not create a mobile support commitment. Keyboard accessibility, zoom, and
readability in desktop windows remain required.

This document is the single source of truth for cross-product UI and
interaction rules. Product or page-specific specifications may add domain
behavior, copy, roles, and acceptance scenarios, but must not redefine the
visual tokens or common interaction states in this document.

The contract is intentionally implementable with the existing Control Plane
stack. The tables below describe the intended shared design, not a claim that all
runtime components already implement it. Record differences in §9; verify each
implementation change against the actual components and rendered UI.

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
| Non-negotiables | Domain, permission, safety, compliance, and desktop layout constraints |

The page type determines what “good” means. This system optimizes for
operable tasks, trustworthy state, and scanability in a Product Console; it
does not apply a landing-page or marketing-page visual standard to operational
work.

## 2. Tali product-family direction

TaskLattice Guard and TaskLattice Relay are two products in the same Tali family.
A user switching products should recognize the same typography, blue primary
action, neutral surfaces, control geometry, focus behavior, and action language.
Product identity comes from the mark, product suffix, domain content, and scope;
it does not require a different palette or component system.

The console remains precise, calm, and compact. Use structured rows and clear
hierarchy, one-pixel boundaries, progressive disclosure, and focused detail or
operation surfaces. Do not turn operational pages into promotional layouts.
The serif brand statement and blue grid belong to the public login surface,
not to tables, settings forms, or resource inspectors.

### 2.1 Reference sources and boundaries

Reference snapshot: **2026-09-19**, from the local Guard repository and rendered
login at `http://localhost:38081/`:

- [Guard theme and typography](../../tasklattice-guard/controller/src/styles.css):
  light neutrals, blue primary, font roles, geometry, and elevation.
- [Guard login](../../tasklattice-guard/controller/src/routes/login.tsx): split
  composition, grid, serif statement, form hierarchy, and account guidance.
- [Guard action conventions](../../tasklattice-guard/docs/ui-action-components-review.md)
  and [Button variants](../../tasklattice-guard/controller/src/components/ui/button.tsx):
  blue create/default, amber edit, red destructive, and neutral inspection.

These relative links require the sibling `tasklattice-guard` checkout. The
normative values are recorded here so the Relay contract is self-contained.
The reviewed Guard CSS defines a light `:root` palette and some component-level
`dark:` variants, but **does not define a complete dark theme token set**.
The dark palette in §4 is a proposed family extension; it is not a report of an
existing Guard dark-mode implementation.

This revision supersedes the 2026-09-17 angular profile, cobalt-indigo palette,
and historical screenshot palettes as design targets. Keep their evidence as
history only. Do not combine those palettes with this one on a new surface.

### 2.2 Shared rules versus product semantics

| Shared across Tali | Product-specific |
| --- | --- |
| Theme roles, font roles, spacing, radii, elevation | Guard shield / Relay lattice mark and product suffix |
| Creation, editing, destruction, inspection semantics | Guardrails, Routers, Evidence versus Agents, Knowledge, Projects |
| Form, menu, table, drawer, focus, pending, and error behavior | Organization versus Platform / Department / Project permissions |
| Login composition and wording pattern | Supported identifiers, actual identity providers, configured default credentials |
| Desktop layout and accessibility requirements | Resource lifecycle, risk, confirmation content, async progress |

A shared appearance never implies shared accounts, permissions, sessions, or
resource ownership. Keep real product boundaries explicit.

### 2.3 Operational composition

For a bounded operation, keep this order: resource identity and impact →
required inputs → progress and validation → secondary details → action footer.
The header and footer remain separate from the scrolling body. Use the
right-side operation drawer contract in §6.5 for persisted resource changes.
Login, theme selection, query filters, and edits to unsubmitted form state do
not acquire an extra operation drawer merely to satisfy visual consistency.

For analytics, use: context → time/filter controls → comparable KPIs → primary
trend → explanatory breakdowns. Each module must answer a distinct question.
Use cards only when they group related content; do not make every item an
equal-weight card. Charts must expose units, legends, keyboard-accessible detail,
and loading, zero-data, unavailable, stale, and error states. Preserve filters
when moving into related details. Shared category meanings keep the same color
role in both modes; use mode-specific contrast values, not screenshot colors.

## 3. Source of truth and precedence

When rules conflict, apply this order:

1. Safety, permission, domain truth, and accessibility requirements.
2. This document's shared tokens and interaction rules.
3. The relevant page or domain specification.
4. Existing component behavior and local implementation detail.

The family design target takes precedence over older Relay styling guidance.
`docs/ui-design-system.md` is the concise companion and
`docs/control-typography.md` owns the detailed font-role explanation; neither
may introduce a competing palette or geometry profile.

Code-level tokens live in `apps/control/src/styles.css`; common behavior lives
in `apps/control/src/components/ui`. Existing typography assertions are in
`apps/control/src/styles.typography.test.ts`. For an implementation migration,
update tokens, affected components, and meaningful tests together. A Spec-only
revision records the target and migration gaps without claiming runtime parity
or triggering an unrequested application-wide restyle.

## 4. Visual system

### 4.1 Color roles and theme pairing

Use semantic tokens; feature pages must not hard-code their own blues, grays,
or action colors. Light and dark modes share hierarchy, density, geometry,
action meaning, and information order. Dark mode is not a color inversion and
must not introduce a separate purple accent, glowing borders, or glass panels.

| Role | Meaning | Required non-color cue |
| --- | --- | --- |
| Primary / blue | Main action, selected interaction | Action label, selected state, or active marker |
| Info / blue | Neutral information | Info label or icon; never an implied successful operation |
| Success / green | Confirmed healthy, applied, or completed | Explicit observed state |
| Warning / amber | Attention, incomplete, pending review | Status label and explanation |
| Danger / red | Failure or destructive operation | Error text or explicit destructive verb |
| Edit / amber | Editing or applying changes | Edit / Apply label; this is an action, not a warning status |
| Neutral | Inspect, cancel, close, metadata | Clear label and hierarchy |

#### 4.1.1 Surface and text tokens

Light core values follow Guard's reviewed `:root` theme. Dark values are the
family extension defined by this Spec. These are implementation targets.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--background` | `#F7F8FA` | `#101828` | Page canvas |
| `--foreground` | `#182230` | `#F2F4F7` | Primary text |
| `--card` | `#FFFFFF` | `#182230` | Working panel and form surface |
| `--card-foreground` | `#182230` | `#F2F4F7` | Panel text |
| `--popover` | `#FFFFFF` | `#1D2939` | Menu, tooltip, floating inspector |
| `--popover-foreground` | `#182230` | `#F2F4F7` | Overlay text |
| `--muted`, `--secondary` | `#F2F4F7` | `#1D2939` | Grouped or quiet control surface |
| `--muted-foreground` | `#667085` | `#98A2B3` | Readable supporting text |
| `--secondary-foreground` | `#344054` | `#EAECF0` | Secondary controls |
| `--border` | `#E4E7EC` | `#344054` | Decorative separators, panel outlines |
| `--input` | `#667085` | `#667085` | Required control boundary, ≥3:1 on card/canvas |
| `--sidebar` | `#FFFFFF` | `#101828` | Permanent navigation |
| `--sidebar-foreground` | `#344054` | `#D0D5DD` | Navigation labels |
| `--sidebar-accent` | `#F2F4F7` | `#1D2939` | Navigation hover surface |
| `--sidebar-accent-foreground` | `#182230` | `#F2F4F7` | Hovered navigation text |
| `--sidebar-border` | `#E4E7EC` | `#344054` | Navigation boundary |

Guard's current light input border is `#D0D5DD`; retain that only as a
supplemental/decorative boundary where another visible cue identifies the
control. The target `--input` above deliberately strengthens standalone field
boundaries for non-text contrast. Quiet panel dividers need not look as strong
as interactive control boundaries. `--surface-panel` aliases `--card` and
`--surface-subtle` aliases `--muted`; do not maintain another neutral palette.

#### 4.1.2 Interaction and semantic tokens

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--primary` | `#2563EB` | `#2563EB` | Filled primary action |
| `--primary-foreground` | `#FFFFFF` | `#FFFFFF` | Label on primary action |
| `--primary-hover` | `#1D4ED8` | `#1D4ED8` | Primary hover |
| `--primary-active` | `#1E40AF` | `#1E40AF` | Primary pressed |
| `--primary-surface`, `--accent` | `#EFF4FF` | `#193153` | Soft selection surface |
| `--primary-border` | `#B2CCFF` | `#3B6BA5` | Selection outline |
| `--accent-foreground` | `#1849A9` | `#BFDBFE` | Text on selection surface |
| `--link` | `#1D4ED8` | `#93C5FD` | Standalone text link / text accent |
| `--ring` | `#1570EF` | `#60A5FA` | Visible keyboard focus |
| `--success` | `#067647` | `#75E0A7` | Success text/icon |
| `--success-surface` | `#ECFDF3` | `#12382A` | Success background |
| `--success-border` | `#ABEFC6` | `#28654F` | Success outline |
| `--warning` | `#93370D` | `#FEC84B` | Warning text/icon |
| `--warning-surface` | `#FFFAEB` | `#3A2D1B` | Warning background |
| `--warning-border` | `#FEDF89` | `#6B532C` | Warning outline |
| `--destructive` | `#B42318` | `#FDA29B` | Destructive/error text/icon |
| `--destructive-surface` | `#FEF3F2` | `#3B2022` | Destructive background |
| `--destructive-border` | `#FECDCA` | `#713438` | Destructive outline |
| `--info` | `#175CD3` | `#84CAFF` | Information text/icon |
| `--info-surface` | `#EFF8FF` | `#15324A` | Information background |
| `--info-border` | `#B2DDFF` | `#275D7E` | Information outline |
| `--edit-foreground` | `#78350F` | `#FDE68A` | Edit action text |
| `--edit-surface` | `#FFFBEB` | `#451A03` | Edit action background |
| `--edit-border` | `#FCD34D` | `#B45309` | Edit action boundary |
| `--edit-hover` | `#FEF3C7` | `#78350F` | Edit hover background |

The focus ring deliberately strengthens Guard's `#2E90FA` light reference for
non-text contrast. Destructive text uses a darker red than Guard's `#D92D20`
so small labels pass on the soft error surface. Primary blue with white text remains a filled-button pair in
both themes; use `--link` or `--accent-foreground` for blue text on dark panels.
Never use a pale dark-mode text accent as a filled button with white text.
`--sidebar-primary` and `--sidebar-ring` alias primary and ring; active navigation
uses `--primary-surface`, `--accent-foreground`, weight, and an active marker.
If components use success/warning/info foreground aliases, map them to the
corresponding semantic text token rather than inventing new colors.

#### 4.1.3 Theme behavior and accessibility

- Workspace preference supports Light, Dark, and System. System follows OS
  changes; explicit choices persist. Resolve the initial theme before paint
  and keep SSR/client state consistent to avoid a bright or dark flash.
- Theme changes preserve filters, selections, unsaved input, route, and open
  work. All portals (menus, dialogs, tooltips, toasts) use the same theme as
  their owning surface; no light dropdown may accidentally inherit a dark root.
- Normal text requires ≥4.5:1 contrast; large text ≥3:1; focus and essential
  control/state indicators ≥3:1 against adjacent surfaces. Check actual
  foreground/background pairs after alpha blending, including hover states.
- Color never carries state alone. Disabled controls must still be legible
  and explain why they are unavailable when the reason is not obvious.
- Charts keep category meaning across themes and use readable axes, legends,
  grid lines, tooltips, and non-color distinctions. Official vendor marks keep
  approved colors; use the vendor's dark-safe asset or a neutral asset backing.
- Full-height split workspaces, including the Vector Database directory tree,
  fill the remaining viewport beneath the header. On desktop the directory
  tree and content area scroll independently, with a collapsible directory
  navigator when more content space is needed.

### 4.2 Typography

Assign fonts by semantic role, not HTML heading level. The family target uses
Guard's Hanken Grotesk interface voice with readable CJK sans fallbacks.

| Role | Family | Use | Weight |
| --- | --- | --- | --- |
| Interface | `Hanken Grotesk`, language-matched `Noto Sans SC` / `Noto Sans TC`, platform sans | Navigation, forms, tables, cards, dialogs, operational titles, metrics | 400 / 500 / 600; 700 sparingly |
| Brand display | Serif stack (`Noto Serif SC` / TC where bundled; Georgia / Songti / platform serif fallback) | Public login statement and login title only | 400–600; avoid synthetic heavy bold |
| Technical | `Chivo Mono`, platform monospace | IDs, endpoints, permissions, hashes, code, YAML, logs | 400 / 500 |

`font-sans` is the operational default. Existing `font-display` on operational
page titles must remain sans-serif; use a dedicated brand-display token or
class for login so a brand font change cannot affect every resource heading.
Relay uses `.login-heading` with bundled `Noto Serif SC Variable` /
`Noto Serif TC Variable` and Georgia / Songti fallbacks, weight 600. Keep these
brand fonts scoped to login; operational display headings stay sans-serif.

Use tabular numerals for changing or aligned metrics, money, durations, and
counts. Uppercase is limited to short labels; product copy and form labels use
normal case. Preserve font licenses for redistributed assets. Load Latin
subsets and unicode-ranged CJK assets; verify English, Simplified Chinese, and
Traditional Chinese for missing glyphs, wrapping, and weight consistency.

### 4.3 Type scale and density

| Role | Size / line height | Use |
| --- | --- | --- |
| Metadata | 12 / 18 px | Supporting text, timestamps, captions |
| Compact UI | 14 / 20 px | Controls, table cells, labels |
| Standard body | 15 / 22–24 px | Explanations and ordinary body text |
| Reading body | 16 / 24 px | Longer guidance |
| Section title | 18 / 26 px, 600 | Operational grouping |
| Page title | 24 / 32 px, 600 | Resource and route identity |
| Login title | 30 / 36 px, serif | Sign-in identity |
| Login statement | 36–48 / 45–60 px, serif | Desktop brand panel |
| Technical compact | 12–13 / 18–20 px | Machine strings |

Default controls are 40 px high in dense desktop contexts and 44 px for form
submission and login. Compact icon controls must remain easy to target with a
mouse and have accessible names and visible keyboard focus. Use density
variants instead of page-local height overrides.

### 4.4 Spacing, shape, and surfaces

Use a 4 px rhythm: 8, 12, 16, 20, 24, 32, 40, 48, and 56 px.

| Token / role | Both themes | Use |
| --- | --- | --- |
| `--radius-badge` | 4 px | Status labels and compact chips |
| `--radius-control` | 6 px | Buttons, inputs, selects, tabs, alerts |
| `--radius-card` | 8 px | Grouped content panels |
| `--radius-large` | 10 px | Floating menus, dialogs, login icon / guidance group |
| Structural edge | 0 px | Shell, split divider, viewport-aligned drawer |
| Circle | 50% | Avatars, radio controls, status dots only |

These Guard-derived values replace the former 2 / 4 px angular target. Avoid
pill buttons and a second outer card around the login form. Use semantic radius
tokens, not arbitrary per-page rounding. One-pixel borders establish ownership;
20–24 px desktop panel padding and 12–16 px row padding establish
rhythm. Use fewer containers when separators and whitespace are sufficient.

Light surface elevation follows Guard: `0 1px 2px rgb(16 24 40 / 0.04),
0 1px 3px rgb(16 24 40 / 0.08)`; overlay elevation is
`0 12px 32px rgb(16 24 40 / 0.16)`. Dark surfaces rely primarily on tonal
separation and borders, with `0 1px 3px rgb(0 0 0 / 0.16)` for raised controls
and `0 12px 32px rgb(0 0 0 / 0.32)` for overlays. No ambient glow or blanket
shadow on every panel.

### 4.5 Layers and motion

Maintain semantic layers: Base → Sticky header → Dropdown → Overlay backdrop →
Modal/drawer → Toast. Avoid ad hoc z-index escalation. Global toast providers
must wrap route content and dialogs, not just the sidebar; an action must never
crash while showing its completion or error feedback.

Routine transitions last 100–200 ms and never exceed 300 ms without a documented
spatial purpose. Animate opacity and transform; avoid decorative bounce,
parallax, or layout shifts. Reduced-motion users receive the same visible state
without decorative motion. Pending actions prevent duplicate submission and
provide text feedback, not only a spinner.

### 4.6 Login and trust-boundary profile

The public login uses a stable **light** product-family surface, even when the
user's workspace preference is Dark or System. The language menu and validation
feedback belong to that light scope. Signing in restores the user's workspace
theme; visiting login must not overwrite it. This is an explicit brand-surface
exception, not incomplete dark-mode coverage of the operational console.

- Desktop (≥1024 px): blue grid brand panel at about 42.5% width, light-neutral
  form area at 57.5%; no outer card. Brand grid uses 48 px cells and white
  one-pixel lines at about 20% opacity. Use 40–56 px horizontal brand padding.
- Brand lockup: product mark in a restrained outline tile, `TaskLattice` plus
  `Guard` or `Relay`. Keep the Relay lattice and Guard shield distinct. The
  protected console may retain its compact `TALI` lockup.
- Brand content: one short category label, a serif product statement, one
  supporting sentence, and a quiet boundary/scope footnote. No feature-card wall.
- Form: top-right language selector; centered form of at most 448 px; lock icon,
  control-plane label, serif product title, description, associated labels,
  credentials, optional session preference, inline error, primary sign-in,
  configured SSO, then account/access guidance. Inputs and buttons are ≥44 px.
- Copy: `Sign in to TaskLattice {Product}` / `登录 TaskLattice {Product}`.
  Relay describes agents, knowledge, and project access; Guard describes its
  actual safety/routing/evidence scope. The Relay statement is “Agents your
  teams can build. Workspaces you can control.” / “让团队构建智能体，让项目运行有边界。”
- Relay currently accepts a username, not Guard's username-or-email contract.
  Show SSO only when configured. Runtime provider failures show an actionable
  error and keep local sign-in available; disabled placeholder SSO is omitted.
- Show default credentials only when the backend explicitly reports active
  development defaults. Relay's existing hint is `admin / password`, not
  Guard's `admin / admin`; never copy credentials or imply shared identity.
- Preserve labels and input on failure, allow password visibility with an
  accessible toggle, prevent duplicate submits, and redirect only after a
  valid session. Guidance must be real, not an inactive support link.

## 5. Information architecture

### 5.1 Global shell

Desktop navigation is persistent and can collapse from 280 px to 72 px. The
collapsed state retains accessible names and tooltips and persists locally.
The active item uses surface, weight, and an accent rule; color alone is not
the active-state signal.

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

### 5.4 Provider and model management

Provider names open a right-side details drawer with connection evidence and
searchable registered models. Explicit validation keeps returned PASS / FAIL
checks and Provider status visible; a fulfilled request is not proof of success.
The drawer and resource menu both offer registration from saved credentials.
Model registration has separate searchable catalog and selected-model lists,
includes manual IDs, and prevents duplicate registration within the account.
Source changes clear stale discovery; background refresh preserves active work.
See the [Provider / Model interaction contract and review](provider-model-interaction-review.md).

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

### 6.2.1 Shared action semantics

| Action | Target variant | Visual treatment |
| --- | --- | --- |
| Create, Add, Duplicate confirmation | `create` | Same filled brand blue as `default` |
| Edit, Apply changes | `edit` | Amber surface, dark/light amber text by theme |
| Delete, Revoke execution | `destructive` | Red semantic text/surface |
| Review, Publish, Run test primary step | `default` | Brand blue |
| Cancel, Close, Back, Copy, Inspect | `outline`, `ghost`, `link` | Neutral or text link |
| Row action entry | `ghost` icon + menu | Neutral ellipsis; items carry action semantics |

Keep one strongest action per bounded task. Editing a draft is not a warning;
creating a resource is not already a green success. Color does not determine
permission, risk, or confirmation requirements. Menus and buttons select a
shared semantic variant; `className` handles layout, not per-page action colors.
The shared primitives own hover, focus, active, and disabled treatment. Hover
must retain the same action meaning; focus must remain visible in both modes.
Detail headers can expose frequent actions directly; rows keep compact menus.
Action entry opens the applicable operation surface rather than silently
performing a persisted mutation.

### 6.3 Forms

- Use labels associated with controls and describe constraints before submit.
- Show only fields relevant to the selected resource or request type.
- Preserve input after validation or backend errors.
- Place the primary action at the end of the decision sequence and give it a
  specific verb, such as `Submit for Approval`, `Create Agent`, or `Load Skill`.
- Use `Save Draft` only when draft semantics are real; a preview must say that
  content exists only in the current session.
- Long forms use a persistent action area with `Cancel`, a secondary action,
  and one primary action. It must not cover the last field.

### 6.4 Dialogs, sheets, and drawers

Use the smallest surface that supports the task:

- Dialog: confirmation, short decision, or focused summary.
- Sheet: bounded create/edit task with several fields or a preview.
- Drawer: contextual detail or a resource operation.
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

Persisted resource changes must begin in a right-side operation drawer on
desktop. Authentication and personal view/theme preferences follow their own
flows; see §2.3 and §4.6. The resource rule applies to create, update, delete, revoke, enable, disable,
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

When resizing a desktop window, preserve the drawer information order, focus
behavior, readable form width, action footer, and state semantics. Long content
scrolls inside the drawer without hiding its actions.

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

## 7. Desktop layout and accessibility contract

- Use semantic HTML, logical DOM order, and meaningful landmarks.
- Support full keyboard operation and visible `focus-visible` states.
- Associate labels, descriptions, errors, and status announcements with their
  controls.
- Dialog focus is trapped and restored correctly.
- Status is never conveyed by color alone.
- Tables have accessible names; wide data uses an explicit content scroll region.
- Inspect ordinary laptop and desktop windows; do not require phone or tablet
  viewport checks.
- Prevent accidental page overflow and clipped controls in desktop layouts.
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

- default/create, edit, outline, secondary, ghost, destructive, and disabled buttons;
- info, success, warning, danger, and neutral status badges/alerts;
- dense label/value rows and semantic data tables;
- page headers with status and action slots;
- dialogs, sheets, drawers, and desktop navigation;
- resource-scoped `More actions` menus that dispatch to a right-side operation
  drawer;
- operation-drawer variants driven by resource type, state, role, and
  permission scope;
- loading, empty, error, and retry surfaces; and
- visible keyboard focus and reduced-motion behavior.

### 9.1 Current alignment and migration gaps — 2026-09-19

The shared Relay theme and primitives have now migrated to the family target.
The table distinguishes implemented foundations from product-wide integration
coverage; a shared-token migration does not certify every business workflow.

| Area | Observed implementation | Target / remaining work |
| --- | --- | --- |
| Relay public login | Fixed light scope, blue grid, Hanken interface, bundled SC/TC serif, strengthened input/focus/error pairs | Keep login independent of workspace theme and preserve language coverage |
| Relay workspace | Hanken + actual variable CJK family names, shared blue and paired neutrals/semantic tokens, 6 / 8 / 10 px geometry | Review specialist charts/editors when their workflows change; do not reintroduce page-local brand palettes |
| Guard light theme | Reference tokens, Hanken / Noto serif roles and shared geometry | Guard remains a separate repository; strengthened control/focus contrast is a documented target difference |
| Guard dark theme | Some `dark:` component variants, no complete `.dark` token set in reviewed CSS | Implement there before claiming cross-product dark parity |
| Action variants | Relay Button supports create/edit; DropdownMenuItem supports edit/destructive; key Knowledge, Memory, Policy, Project, Account and Platform settings actions migrated | Other existing default actions retain blue; classify remaining specialist actions by business meaning as they are reviewed |
| Tests | Typography contract updated; paired semantic contrast and fixed-light login scope are regression-tested | Browser evidence remains necessary for alpha blending, focus, overflow, and actual state transitions |
| Shared geometry / layers | Floating surfaces use shared elevation; policy/project pending chrome reflects submission | Some older route-local styling and inline settings mutations remain; their behavior is not certified by this theme pass |


Keep existing working resource actions, permissions, async state, and drawer
behavior intact during theme migration. Provider-dependent operations require
real integration evidence; a component fixture cannot prove external success.
Migrate shared tokens and primitives first, then shell/tables/forms/drawers,
then product-specific surfaces. Compare both products at the same viewport,
locale, theme, density, and state; a light login screenshot alone cannot certify
dark workspace parity.

For repeatable local interaction review, run
`npm run dev:ui-review --workspace @tali/control` and open `/ui-review.html` on
the review server. This development-only entry renders the actual shared and
file-operation components, with explicitly simulated responses and no API
calls. Exercise menu dispatch, Escape/focus return, pending duplicate-submit
prevention, error/input preservation, retry, name-confirmed deletion, and
desktop light/dark presentation.

This list is deliberate gap reporting, not permission to add more exceptions.

### 9.2 Family implementation review — 2026-09-19

Scope: shared theme/primitives and the named operation paths, not a complete
provider/backend acceptance run. See [review evidence](ui-family-review-2026-09-19.md).
Type checking, production Control image build, and 50 frontend test files /
259 tests passed. Real UI and isolated shared-component checks are recorded
separately; simulated operation success is never evidence of persisted changes.

### 9.3 Historical angular-profile verification — 2026-09-17

Historical evidence only: these token choices are superseded by the family target.
The mobile checks below are archived observations, not current requirements;
version 1.3 establishes desktop-only scope.
The scores below do not certify the new family target or current release.

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
| Excessive pills | Use the 4 px status-badge token; reserve circles for avatars, radios, and dots | Status badges remain distinguishable from controls |

Do not solve a hierarchy problem with decoration. First adjust information
order, type, spacing, density, or surface ownership; add a visual accent only
when it has a documented product or state role.

## 11. Verification and definition of done

A runtime UI change is complete only when:

1. The relevant domain behavior and permissions are documented.
2. Default, hover, focus-visible, active, loading, success, empty, error,
   disabled, and recovery states are implemented or explicitly marked as a
   known gap.
3. Unit tests, type checking, and the production build pass.
4. Desktop rendering is inspected at representative laptop and desktop window sizes.
5. There is no horizontal overflow, clipped content, unreadable text, broken
   asset, or unnamed/unreachable control in the supported desktop layout.
6. The primary path and at least one failure/recovery path produce visible
   feedback.
7. Browser console errors and missing first-party assets are absent.
8. A release change has evidence for the applicable API, auth, permission,
   and runtime truthfulness checks.

Block release regardless of visual score when the primary task is broken,
state is misleading, a permission boundary is bypassed, controls are
disconnected, or the page cannot be operated accessibly.

### 11.1 Product-family theme acceptance matrix

For an implementation release, record screenshots and interaction evidence for
these pairs. Mark unimplemented or untested cells explicitly; do not score them
as passes. Documentation-only changes require consistency and link checks, not
fabricated browser evidence or a runtime release score.

| Surface / state | Light | Dark | Desktop layout / interaction evidence |
| --- | --- | --- | --- |
| Public login | Fixed family light scope | Same fixed light scope with dark workspace preference retained | Desktop; EN / zh-CN / zh-TW; password reveal, error/retry, success |
| Shell and resource list | White navigation and work surfaces | Navy canvas with raised surfaces | Expanded/collapsed navigation, active state, long names |
| Create / edit form | Blue create, amber edit | Same semantics with dark text/surface pairs | Focus order, validation, pending, input preservation, safe retry |
| Operation drawer / delete | Light panel and red destructive action | Dark raised panel and readable red action | Escape/focus restoration, fixed footer, overflow, name/impact confirmation |
| Menu / tooltip / toast | Owner's light tokens | Owner's dark tokens | Portal inheritance, readable labels, no provider/context crash |
| Knowledge file browser | Full-height directory and content panels | Same geometry with dark roles | Independent scrolling, folder selection, collapsible directory |
| Status / chart / empty state | Semantic labels, readable data colors | Same meaning with adjusted contrast | Non-color cue, correct units, zero/error/loading recovery |

Check representative text, focus, input, selected, and semantic color pairs
against §4.1.3. Verify System-theme changes and first paint separately from a
manual theme toggle. Do not require Guard dark screenshots until its target
palette is implemented; record that as a cross-product implementation gap.

## 12. Review gate and evidence model

### 12.1 Six dimensions

Each review records evidence, deduction reasons, and recommendations before
calculating a score. Score every applicable subcheck from 0 to 2:
`2 = pass`, `1 = partial`, `0 = fail`. A critical failure is recorded as a
blocker even if the average score passes.

| Dimension | Verify |
| --- | --- |
| Product Intent | Value, target user, primary task, tone, first-screen priority, and CTA match the real goal |
| Information Architecture | Hierarchy, grouping, order, density, rhythm, navigation, and desktop window layout make the task findable |
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
| `release_gate` | Delivery acceptance | 8.0 | Require production paths, navigation, data, accessibility, desktop layout, and key states |

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
4. **Screenshots** — representative desktop windows and full-page captures
   where content length matters. Mobile screenshots are not required.

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
desktop layout rules, or accessibility requirements.

`docs/interaction-design.md` remains the Marketplace information architecture
and domain direction. `docs/design/approval-interaction-spec.md` remains the
Approval page's detailed flow and acceptance record. They may specialize this
contract but must link back here when they describe shared behavior.
