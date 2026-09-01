# TaskLattice Relay UI and Interaction System

Status: Implemented baseline

Version: 0.2

This contract applies the Vibe Designing evidence model to TaskLattice Relay. It
covers authentication and the protected Project console.

## Product intent

TaskLattice Relay helps an operator declare, provision, inspect, and enter an
isolated Agent runtime. The interface must keep desired Agent configuration and
actual sandbox state distinguishable. It must never imply that a provisioning
request succeeded before the runtime reports success.

The control console prioritizes the operating task and current state over
marketing expression.

## Visual intent

- Temperament: operational, precise, direct, and calm.
- Brand signal: graphite primary actions keep the interface calm and legible.
  A restrained cobalt marks navigation selection, focus, links, and
  informational state. Green remains semantic success rather than ambient
  brand decoration.
- Neutral system: light mode uses a white working field, a `#fbfbfc` sidebar,
  and cool near-white secondary planes around `#f5f6f8`. Dark mode uses a
  `#1d1d1f` working field, a `#151517` sidebar, and `#27272a` raised surfaces.
  Most hierarchy comes from whitespace, typography, and low-contrast rules.
- Typography: `Inter` with `Noto Sans SC` / `Noto Sans TC` fallbacks for display
  and interface text; `Chivo Mono` for identifiers and operational evidence.
- Shape: one-pixel rules, 10-pixel functional controls, and 14-pixel grouped
  panels. Compact state badges may be pill-shaped. Hierarchy comes from type,
  spacing, density, and section lines rather than heavy shadows or a wall of
  equal cards.
- Motion: short state transitions only. Honor `prefers-reduced-motion`.

### Logo contract

- The mark is a seven-node triangular lattice: isolated runtime nodes become a
  connected orchestration boundary and converge on one execution point.
- The primary lockup uses `TALI` as the compact wordmark and `TaskLattice Relay` as
  the durable product name. The mark remains recognizable without the wordmark
  in collapsed navigation and favicon contexts.
- Light surfaces use a darker cyan signal for contrast; dark assets use the
  storyboard cyan `#42e3ff`.
- The protected console keeps the lattice mark static.

## Navigation contract

Desktop navigation is permanent and can collapse from 280 pixels to 72 pixels.
The preference persists locally. Collapsed navigation retains tooltips and
accessible names. The active item uses both surface and weight, not color
alone.

Mobile navigation is an overlay drawer. It opens from the menu button and
closes through its close button, backdrop click, navigation, or Escape. The
page returns to an unobstructed state after dismissal.

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

States:

- Loading: keep the form stable and prevent duplicate submission.
- Invalid credentials: show a persistent, text-labelled recovery message.
- Development defaults: explicitly warn that `admin / admin` is active.
- SSO unavailable: keep local login available and surface the provider error.
- SSO callback: show a single-purpose completion state, then validate the
  returned TaskLattice Relay session before entering the Project console.
- Expired session: clear stored credentials and return to login.
- Project switcher: search and switch Project context. The current Project row
  exposes a separate 44px settings action to Project Administrators; the row
  itself remains dedicated to context switching. Project creation remains in
  Department settings.
- Settings navigation: Platform, Department, and Project settings share
  `ContextSidebarLayout`, `ContextSettingsSidebar`, and the same grouped mobile
  selector. The scope-specific content changes, but the two-sidebar navigation
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
- Keep interactive targets at least 44 by 44 CSS pixels where touch applies.
- Never remove focus indicators; use visible `focus-visible` treatment.
- Keep DOM and visual order aligned.
- Do not use color as the only status signal.
- Provide a specific recovery action for failure and empty states.
- Keep animation under 300 milliseconds unless a documented spatial transition
  needs more time; animate transform and opacity by default.
- Avoid gradients, indiscriminate blur, emoji iconography, decorative bounce,
  and repeated equal-weight cards. Purple is reserved for explicit interactive
  emphasis and never used as an ambient gradient.

## Evidence gate

Use `release_gate` for changes intended for deployment. A pass requires:

1. Unit tests, type checking, and production build succeed.
2. Unauthenticated Agent API access returns 401.
3. Local login, session resolution, protected Agent access, and sign out work.
4. SSO start produces PKCE, nonce, state protection, and the configured redirect.
5. Desktop login, expanded/collapsed console, and mobile layouts render
   without overflow or unreadable text.
6. Mobile navigation opens and closes with Escape.
7. The main CTA and primary control path produce visible feedback.
8. Browser console has no application errors or missing first-party assets.

Score Project pages with the Product Console profile. Treat broken auth, a
broken primary operation, generic template output, or an inconsistent component
system as blockers regardless of the weighted score.
