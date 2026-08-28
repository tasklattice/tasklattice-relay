# TaskLattice UI Modernization Plan

## Direction

**Calm Enterprise Console** — a soft-edged, medium-density enterprise interface that keeps operational clarity while reducing visual noise.

The goal is not to make every surface pill-shaped or pale. The goal is to preserve trustworthy text and state contrast, then soften the system through better surface hierarchy, restrained borders, consistent radii, comfortable spacing, and progressive disclosure.

## Product constraints

- TaskLattice is an operational console for Agents, Memory, Skills, MCP connections, runtime policies, vector databases, traces, audit evidence, and cost.
- Dense pages must remain scannable; governance and destructive states must remain explicit.
- One design language must work for both data-heavy workbenches and guided creation flows.
- Desktop is the primary workspace, but core actions and drawers must remain usable on mobile.
- Existing terminology, permissions, status semantics, and task paths should be preserved.

## Design principles

1. **Quiet surfaces, readable content.** Lower boundary contrast, not text contrast.
2. **One strong action per viewport.** Brand color and solid fills are scarce resources.
3. **Medium density by default.** Avoid both spreadsheet compression and oversized marketing spacing.
4. **Round by role.** Controls, cards, dialogs, and status pills use different radii; tables do not become a wall of bubbles.
5. **Progressive disclosure.** Keep the current task visible and reveal secondary complexity when requested.
6. **Motion explains space.** Drawers, selections, and expanded sections transition in 160–220 ms without bounce.
7. **Risk remains sharp.** Errors, destructive actions, access boundaries, and policy violations keep strong semantic contrast.

## Proposed visual tokens

| Role | Current direction | Proposed direction |
| --- | --- | --- |
| Page background | `#fafafa` | `#f6f7f8` |
| Primary surface | `#fafafa` | `#ffffff` |
| Subtle surface | `#f2f2f2` | `#f8f9fa` |
| Foreground | `#191a1b` | `#24272b` |
| Muted foreground | 62% foreground | `#70757d` |
| Structural border | 9% black | 7–9% ink |
| Input border | 20% black | 12–14% ink |
| Primary action | saturated violet | near-black ink or one controlled brand fill |
| Selection / focus | saturated violet | slate-blue outline with a pale blue halo |
| Badge radius | 4 px | status pill; code/tag 8 px |
| Control radius | 6 px | 12 px |
| Card radius | 8 px | 16 px |
| Dialog / floating panel | 6–10 px | 20 px |
| Shadow | inconsistent | `0 1px 2px / 3%` plus `0 8px 24px / 4%` only for elevation |

## Typography

- Keep the existing language-aware sans stack initially; typography is not the primary source of hardness.
- Use weight 400 for body copy, 500 for labels and controls, and 600 for page and section titles.
- Reserve 700 for critical counts or exceptional emphasis.
- Default body line height: 1.5; supporting copy: 1.55–1.65.
- Standardize product-console page titles on sans. Serif can remain only in intentional brand or editorial moments.
- Avoid uppercase metadata unless the term is genuinely a code or protocol.

## Density and spacing

| Context | Target |
| --- | --- |
| Global top bar | 64–72 px |
| Main page padding | 24 px tablet, 32–40 px desktop |
| Page section gap | 24–32 px |
| Card padding | 20–24 px |
| Form section gap | 16–20 px |
| Control height | 44 px default |
| Data row height | 64–72 px comfortable, 52–56 px compact |
| Operational content width | up to 1440 px |
| Guided workflow width | 840–960 px |
| Reading line length | 60–75 characters |

## Component rules

### Buttons

- Use one solid primary action per page or active workflow.
- Outline buttons use a softer border and gain a subtle surface on hover.
- Icon-only controls remain at least 44 × 44 px.
- Destructive actions use tinted red surfaces until the final confirmation.

### Inputs and selectors

- 12 px radius, 44 px height, subtle background separation.
- Focus uses a 1 px blue edge plus a low-opacity outer halo.
- Labels remain close to their controls; helper copy sits beneath the label, not as placeholder-only instruction.

### Cards

- Cards are used for meaningful grouping or selection, not every paragraph.
- Selectable cards place a small semantic icon chip above the label, matching the supplied references.
- Selected cards use a blue outline and pale halo, not a saturated fill.

### Status and metadata

- Status badges are pills with semantic, low-saturation backgrounds.
- IDs, versions, and protocol labels use compact 8 px tags rather than pills.
- Never use brand color as a replacement for success, warning, failure, or policy state.

### Tables

- Round the table container, not every row.
- Keep row separators faint; use whitespace and alignment for scanning.
- Hover and selection use a soft surface. Row actions appear without shifting layout.
- Offer a compact density only on genuinely data-heavy pages.

### Drawers and dialogs

- Drawers overlay rather than reflow the workbench.
- Dialogs use 20 px radius and a restrained shadow; full-height edge-attached drawers may keep the viewport edge square.
- Secondary sections scroll inside the panel while the title and critical actions remain stable.

### Information affordances

- Use small icon chips for object types, choices, and key concepts.
- Use a 20–24 px `i` help control next to unfamiliar labels; reveal concise guidance on hover, focus, or click.
- Do not decorate ordinary headings with icons when the icon adds no semantic value.

## Interaction rules

- Hover: 120–160 ms color/surface transition.
- Drawer and dialog: 180–220 ms transform and opacity transition.
- Selection: immediate border feedback, with content changes completed within 180 ms.
- Loading under 300 ms: preserve the layout without flashing a spinner.
- Longer loading: skeleton first; status explanation and recovery action after 2 seconds.
- Respect reduced-motion preferences.
- Every async action exposes pending, success, failure, and retry states.

## Page archetypes

### 1. Operational console

Examples: Instances, Memory, Vector Databases, Audit Logs.

- Wide content area, moderate density, one filter surface, one main data surface.
- Clicking a row opens a right-side detail drawer without changing table width.
- Use compact status pills and align metadata consistently.

Prototype: [01-operations-console.html](./01-operations-console.html)

### 2. Guided creation workflow

Examples: Create Instance, register an Agent, configure Memory, create a runtime policy.

- Centered 840–960 px work canvas.
- Sectioned cards, visible progress, helper text, icon-led choices, and progressive disclosure.
- One sticky or stable primary action; advanced settings remain collapsed until needed.

Prototype: [02-guided-creation-flow.html](./02-guided-creation-flow.html)

### 3. Inspection workbench

Examples: Traces, Cost, runtime health.

- Preserve tighter data density and stronger evidence hierarchy.
- Use rounded outer containers but keep charts, timelines, and code blocks geometrically precise.
- Do not weaken anomaly, failure, or confidence signals.

### 4. Governance and destructive flows

Examples: Access Policies, Runtime Policies, deletion and revocation.

- Maintain higher contrast, explicit impact summaries, and deliberate confirmation steps.
- Softer geometry must not make irreversible actions look casual.

## Rollout plan

### Phase 0 — Design contract

- Finalize semantic color, radius, elevation, density, and motion tokens.
- Define exceptions for audit, terminal, code, risk, and destructive surfaces.
- Capture light and dark mode pairs before changing feature code.

### Phase 1 — Primitives and pilot

- Update Button, Input, Select, Badge, Card, Dialog, Sheet, Tooltip, and table container variants.
- Pilot on Instances and Create Instance—the two prototypes represented here.
- Validate desktop and mobile, keyboard navigation, focus visibility, and reduced motion.

### Phase 2 — High-frequency catalog pages

- Migrate Memory, Skills, MCP Connections, and Vector Databases.
- Consolidate duplicated feature-level radius and border literals.
- Standardize list selection and detail-drawer behavior.

### Phase 3 — Operational workbenches

- Migrate Traces, Audit Logs, Cost, and Instance details with density exceptions.
- Preserve code, charts, terminal, evidence, and status semantics.

### Phase 4 — Governance and polish

- Migrate policy editors, platform settings, permission surfaces, and destructive flows.
- Complete dark-mode parity and contrast audits.
- Remove legacy styling escape hatches once screenshots and task paths pass.

## Acceptance criteria

- A five-second scan reveals the page title, primary task, current state, and one primary action.
- No viewport contains more than one unrelated solid primary CTA.
- Default controls remain at least 44 px and keyboard focus remains obvious.
- Body and supporting text meet WCAG AA contrast; reduced boundary contrast never reduces legibility.
- Dense tables remain scannable at 1280 px without horizontal clipping.
- Guided flows remain readable at 390 px and never hide the primary action.
- Drawers do not reflow the underlying workbench.
- Radius, color, and elevation are drawn from semantic tokens rather than feature literals.

## Avoid

- Replacing every radius with `rounded-xl`.
- Making every section an equal card.
- Lowering all text opacity to imitate a reference screenshot.
- Using blur or glass on ordinary content surfaces.
- Applying brand color to every selected, active, success, and informational state.
- Hiding required labels inside placeholders.

These prototypes are directional interaction artifacts. They intentionally use representative data and do not change production behavior.
