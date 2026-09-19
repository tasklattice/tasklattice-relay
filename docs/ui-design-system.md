# TaskLattice Relay UI and Interaction System

Status: Supporting family-design target; canonical contract: [UI Interactive Spec](ui-interaction-spec.md).

The canonical contract takes precedence over historical examples in this document.

Version: 0.4 (2026-09-19; Tali / Guard alignment; desktop only)

This contract applies the Vibe Designing evidence model to TaskLattice Relay. It
covers authentication and the protected Project console. The entire Relay
project targets desktop Web only. Mobile/tablet design and acceptance are out
of scope unless explicitly requested by the user. Existing responsive fallbacks
are not a support commitment.

## Product intent

TaskLattice Relay helps an operator declare, provision, inspect, and enter an
isolated Agent runtime. The interface must keep desired Agent configuration and
actual sandbox state distinguishable. It must never imply that a provisioning
request succeeded before the runtime reports success.

The control console prioritizes the operating task and current state over
marketing expression.

## Shared Tali visual intent

Guard and Relay share a visual family: brand blue, cool neutral surfaces,
Hanken Grotesk interface text, readable CJK fallbacks, restrained rounded
controls, clear action semantics, and consistent keyboard/pending/error states.
Product marks, content, and permission scopes remain distinct.

The canonical [Spec §4](ui-interaction-spec.md#4-visual-system) owns the complete
light/dark token tables. This companion must not define an alternate palette.

| Dimension | Family contract |
| --- | --- |
| Light | Guard-derived `#F7F8FA` canvas, white cards/sidebar, `#182230` text, quiet cool-gray separators |
| Dark | Proposed `#101828` canvas/sidebar, `#182230` panels, `#1D2939` overlays, readable light text; same hierarchy and geometry |
| Primary | `#2563EB` filled blue with white text in both themes; separate readable link/focus tokens |
| Action semantics | Blue create/default, amber edit/apply, red delete/revoke, neutral inspect/cancel |
| Interface typography | Hanken Grotesk + language-matched Noto Sans SC / TC; operational headings stay sans-serif |
| Brand typography | Serif statement and title on public login only; no serif tables, forms, or console headings |
| Technical typography | Chivo Mono for IDs, endpoints, logs, YAML, code; tabular numerals for aligned metrics |
| Shape | 4 px badges, 6 px controls, 8 px cards, 10 px floating surfaces; structural edges and docked drawers 0 px |
| Density | 40 px desktop controls, 44 px login/form submission; compact rows with readable labels |
| Elevation | One-pixel borders and tonal separation; subtle raised controls and overlays; no glow or ambient gradients |
| Motion | Short feedback transitions, reduced-motion support, no decorative bounce |

The reviewed Guard CSS has no complete dark token set. Dark values are a family
extension defined by the Spec, **not an already-verified Guard implementation**.
Relay's shared workspace and login now use the family theme, with Hanken,
correct variable CJK fallbacks, and the shared geometry. See [migration gaps](ui-interaction-spec.md#91-current-alignment-and-migration-gaps--2026-09-19).

### Theme and contrast

Workspace themes are Light, Dark, and System. Switching themes preserves work,
selection, and route; resolve initial theme before paint. Menus, tooltips,
drawers, and toasts inherit the owning surface's theme, including portals.
Normal text requires 4.5:1 contrast, large text and essential non-text indicators
3:1. Check actual alpha-composited surfaces and hover/focus states.

Official vendor identities keep approved colors; choose a dark-safe asset or
neutral backing when needed. Do not recolor every vendor mark blue or use a
generic Lucide icon when an official asset is available. State labels and
icons supplement colors in charts, navigation, and feedback.

### Logo contract

- Relay keeps the seven-node triangular lattice; Guard keeps its shield.
- Public login uses `TaskLattice` plus a product suffix in the same lockup
  structure; protected navigation may retain the compact `TALI` wordmark.
- Marks use foreground color on neutral surfaces and white on the blue login
  panel. Do not restore the historical cyan signal as a competing brand accent.
- The protected console keeps the lattice static. Compact marks retain an
  accessible product/home label through their enclosing control.

## Navigation contract

Desktop navigation is permanent and can collapse from 280 pixels to 72 pixels.
The preference persists locally. Collapsed navigation retains tooltips and
accessible names. The active item uses both surface and weight, not color
alone.

Unavailable future sections are visibly disabled, marked `Later`, and explain
their relationship to the current Agent path through a tooltip. They are not
presented as broken links.

The account control stays at the bottom of navigation and exposes the actual
identity provider plus sign out. The top bar contains route context, the
environment, and intentionally disabled future search.

### Project page hierarchy

The top-bar breadcrumb is the only route-context label. Project pages must
not repeat that context as an eyebrow above the page title.

Every Project route begins with the shared `PageHeader` structure:

1. a page-specific `h1` title with an optional status badge;
2. a concise task or scope description when it adds useful context;
3. page-level actions aligned with the title block.

`PageHeader` accepts `title`, `description`, `badge`, and `actions`. It does not
accept an eyebrow or breadcrumb prop. Breadcrumb construction remains owned by
`AppShell`, so route hierarchy cannot drift between the top bar and page body.

## Authentication contract

The login page supports configured local credentials and optional OIDC SSO.
Local login and SSO resolve to the same TaskLattice Relay session and protected API
boundary.

The public login is a fixed light brand surface with a blue grid panel and
serif brand/title typography, independent of the user's workspace theme. The
form is at most 448 px wide alongside the desktop brand panel. The language
menu shares the light scope. Visiting login must not change the workspace preference.

Use “Sign in to TaskLattice Relay” and copy about agents, knowledge, and project
access. The local identifier remains Username. Maintain English, Simplified
Chinese, and Traditional Chinese. Password visibility, session preference,
pending submission, and credential recovery must remain operable.

States:

- Loading: keep the form stable and prevent duplicate submission.
- Invalid credentials: show a persistent, text-labelled recovery message.
- Development defaults: show `admin / password` only when the Relay backend
  reports that development defaults are active. Never copy Guard credentials.
- SSO unconfigured: omit the SSO action rather than showing a dead control.
  Configured provider failure: keep local login available and surface recovery.
- SSO callback: show a single-purpose completion state, then validate the
  returned TaskLattice Relay session before entering the Project console.
- Expired session: clear stored credentials and return to login.
- Project switcher: search and switch Project context. The current Project row
  exposes a separate 44px settings action to Project Administrators; the row
  itself remains dedicated to context switching. Project creation remains in
  Department settings.
- Settings navigation: Platform, Department, and Project settings share
  `ContextSidebarLayout` and `ContextSettingsSidebar`. The scope-specific content changes, but the two-sidebar navigation
  model does not.
- My Account: open from the account menu and contain user-owned details,
  accessible Projects, account type, theme, local time zone, and local-account
  password reset independently of the current Project. For SSO accounts, the
  Security section exposes a safe, read-only diagnostic view of provider,
  issuer, subject, scopes, group claim, resolved groups, and synchronization
  time; raw tokens and secrets never reach the browser.
- Sign out: live only in the account menu. Local accounts clear the Relay
  session directly. OIDC accounts first clear the Relay session and then use
  the Provider's token-revocation and RP-Initiated Logout endpoints. Relay also
  removes its cached access, refresh, and ID tokens, and the browser can choose
  another SSO account on its next sign-in. If Provider logout is unavailable,
  local session deletion still succeeds.

Production requires an explicit signing secret and local password/hash. OIDC
uses discovery, Authorization Code, PKCE, nonce, signed state storage, issuer,
audience, expiry, and provider signing-key validation.

## Platform people administration

The Platform People page is an operational data table, not a collection of
free-form profile rows. TanStack Query owns the server query lifecycle and
TanStack Table owns column structure. Search, Department filter, Project
filter, page, and page size are explicit query inputs; pagination is performed
by the Control API.

The table exposes Platform Administrator, Department Administrator, and
Project Administrator as three independent scopes. A person may hold any
combination of them. Department and Project membership cells show the exact
resource name and effective Role; status remains a separate column. Fixed
column definitions, semantic table markup, stable loading data, an empty state,
and retry affordance prevent the alignment drift of free-form grid rows.

## Platform Role catalog

Roles & Capabilities is a read-only operational catalog, not a Role creation
screen. It presents two groups: Administration and Project business roles.
Administration contains Platform Administrator, Department Administrator, and
Project Administrator with their scope displayed explicitly. Project business
roles contain Agent Developer, User, Auditor, and Reviewer.

Each expandable row shows the stable Role ID, scope, catalog revision, enabled
CAP count, resource relations when applicable, and enabled/disabled state for
every Capability registered in that scope. The page reads the same persisted
catalog as runtime admission. It must not display an Add Role action until a
custom-Role lifecycle, validation model, and safe migration contract exist.

## Component and accessibility rules

- Preserve semantic buttons, links, labels, headings, navigation, and main
  landmarks.
- Keep desktop controls easy to target and fully operable with a keyboard.
- Never remove focus indicators; use visible `focus-visible` treatment.
- Keep DOM and visual order aligned.
- Do not use color as the only status signal.
- Provide a specific recovery action for failure and empty states.
- Keep animation under 300 milliseconds unless a documented spatial transition
  needs more time; animate transform and opacity by default.
- Avoid gradients, indiscriminate blur, emoji iconography, decorative bounce,
  and repeated equal-weight cards. Purple is not an alternate primary color;
  any additional data color needs an explicit, stable meaning.

## Evidence gate

Use `release_gate` for changes intended for deployment. A pass requires:

1. Relevant tests, type checking, and production build succeed for runtime
   changes. Spec-only revisions check consistency and links instead.
2. Unauthenticated Agent API access returns 401.
3. Local login, session resolution, protected Agent access, and sign out work.
4. SSO start produces PKCE, nonce, state protection, and the configured redirect.
5. Desktop login and expanded/collapsed console render without accidental
   page overflow or unreadable text at representative desktop window sizes.
6. Menus and drawers support Escape and restore focus to their trigger.
7. The main CTA and primary control path produce visible feedback.
8. Browser console has no application errors or missing first-party assets.
9. The [theme acceptance matrix](ui-interaction-spec.md#111-product-family-theme-acceptance-matrix)
   records Light/Dark/System, portal, contrast, and desktop layout evidence;
   unimplemented or untested states are explicitly marked.

Score Project pages with the Product Console profile. Treat broken auth, a
broken primary operation, generic template output, or an inconsistent component
system as blockers regardless of the weighted score.
