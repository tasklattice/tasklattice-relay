# Control Plane typography

The Control Plane uses typography as an information hierarchy, not as decoration.
Font families are assigned by semantic role so that the same kind of information
looks consistent across pages, cards, dialogs, sheets, tables, and charts.

## Font families

Canonical authority: [UI Interactive Spec](ui-interaction-spec.md), sections 4.3–4.6.

| Role | Family | Use | Weights |
| --- | --- | --- | --- |
| Interface | Inter, with Noto Sans SC / TC language fallbacks | Navigation, body copy, controls, section headings, card titles, status, and numeric metrics | 400, 500, 600, 700 |
| Display | Inter, with Noto Sans SC / TC language fallbacks | Page titles, entity identity, and the login statement | 600 |
| Technical | Chivo Mono | Permissions, IDs, endpoints, model names, routes, code, logs, YAML, and machine values | 400, 500 |

All selected families are distributed under the SIL Open Font License 1.1. Keep
their license files with redistributed font software and do not sell the font
files by themselves.

## Semantic rules

- Use `font-display` only for page or entity identity. Do not infer it from an
  `h1`, `h2`, or `h3` element.
- Use `font-sans` for operational hierarchy: card, dialog, drawer, sheet,
  section, form, table, and empty-state titles.
- Use `font-mono` for strings produced or consumed by systems. Native `code`,
  `kbd`, `samp`, and `pre` elements inherit this role automatically.
- Use tabular numerals for metrics, money, durations, and counts when values
  update or align vertically.
- Prefer 400 for body copy, 500 for values and compact emphasis, 600 for
  operational headings and actions, and 700 only for strong identity accents.
- Avoid uppercase body copy. Uppercase is reserved for short navigation or
  technical labels with deliberate tracking.

## Loading strategy

Inter and Chivo Mono load their Latin subsets. Noto Sans SC and Noto
Sans TC load variable, unicode-ranged WOFF2 assets so Chinese glyphs are
consistent without downloading the entire CJK family on every page. The browser
requests only the ranges used by visible text.
