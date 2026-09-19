# Control Plane typography

Version: 0.2 — Tali product-family target, 2026-09-19.

Canonical authority: [UI Interactive Spec](ui-interaction-spec.md), §§4.2–4.3
and §4.6. Guard and Relay use the same semantic font roles; typography expresses
information hierarchy rather than a different theme for each product.

## Font families

| Role | Target family | Use | Weights |
| --- | --- | --- | --- |
| Interface and operational titles | Hanken Grotesk, Noto Sans SC / TC, platform sans | Navigation, body, controls, page titles, card/dialog headings, tables, status, metrics | 400, 500, 600; 700 sparingly |
| Brand display | Noto Serif SC / TC where bundled, Georgia / Songti / platform serif fallback | Public login statement and login title only | 400–600; avoid synthetic heavy bold |
| Technical | Chivo Mono, platform monospace | IDs, permissions, endpoints, model names, routes, code, logs, YAML, machine values | 400, 500 |

Use `Noto Sans SC` / `Songti SC` for Simplified Chinese and `Noto Sans TC` /
`Songti TC` for Traditional Chinese. Language-specific stacks must be verified
for complete glyphs and consistent weight. Font roles and sizes do not change
with theme; color contrast changes through semantic theme tokens.

## Semantic rules

- `font-sans` is the default for operational hierarchy, including route and
  resource titles. HTML heading level does not automatically choose a family.
- Existing operational `font-display` consumers must stay sans-serif. Introduce
  a separate brand-display token/class rather than changing those headings to
  serif. The Relay login currently uses `.login-heading`.
- Reserve serif type for the login statement and sign-in title. Form labels,
  credential inputs, helper text, notices, buttons, and language controls stay
  in the interface family.
- Native `code`, `kbd`, `samp`, and `pre` inherit the technical role. Use tabular
  numerals for metrics, money, durations, and counts that align or update.
- Prefer 400 body, 500 compact emphasis, 600 operational headings/actions; use
  normal case for body copy. Short category labels may use uppercase and tracking.
- Default sizes: 14/20 px compact UI, 15/22–24 px body, 12/18 px metadata,
  24/32 px operational page title, 30/36 px login title, 36–48/45–60 px desktop
  brand statement. Let Chinese and long product names wrap without clipping.

## Loading and licensing

Load Latin subsets of Hanken Grotesk and Chivo Mono; use unicode-ranged CJK WOFF2
assets and `font-display: swap`. Bundle matching serif subsets if identical
cross-platform display typography is required. System Georgia/Songti are
fallback references, not bundled project assets. Keep the licenses of all
redistributed font packages; do not assume system fonts may be redistributed.

## Implementation status and migration

The Relay shared-font migration is implemented as of 2026-09-19:

- Global interface and operational display roles use Hanken Grotesk, matching
  the actual bundled `Noto Sans SC Variable` / `Noto Sans TC Variable` family
  names. Chivo Mono remains the technical role; Inter imports were removed.
- The login uses bundled `Noto Serif SC Variable` / `Noto Serif TC Variable`
  through `--font-brand`, weight 600, with system serif fallbacks. This role
  does not replace operational `font-display`.
- Guard uses Hanken Grotesk + Noto Sans SC and bundled Noto Serif SC; its source
  package differs, but both products now use the same semantic font roles.
- Typography regression assertions now enforce the family roles and radii;
  paired theme contrast is checked independently in `styles.theme.test.ts`.

Verify English, Simplified Chinese, and Traditional Chinese at laptop and
desktop window sizes in both workspace themes. Check font loading, fallback, heading
wrapping, baseline alignment, input height, and layout shifts on the rendered
page. A shared family name in CSS alone does not prove visual parity.
