# Relay UI family alignment review — 2026-09-19

Canonical contract: [UI and interaction specification](ui-interaction-spec.md).
Scope: desktop Web, shared visual foundations and representative interactions.
This is not a complete backend/provider acceptance run.

## Findings and changes

- Workspace colors, typography, and geometry differed from the Guard family
  target. Shared light/dark tokens now use family blue, neutral surfaces,
  Hanken Grotesk, matching variable CJK font names, and 6 / 8 / 10 px radii.
- Login uses its own fixed-light scope, blue grid, and bundled SC/TC serif
  brand typography. Operational headings remain sans-serif.
- Primary blue was also used for small text on dark surfaces. Separate link
  tokens now keep text readable without changing filled action colors.
- Buttons and menus now expose explicit create, edit, and destructive semantics.
  Knowledge, Memory, Policy, Project, Account, and Platform settings received
  targeted action updates; edit actions use amber, creation blue, deletion red.
- Shared floating surfaces use consistent elevation. Project and policy form
  pending state is passed to the operation sheet to prevent conflicting actions.

## Verification

- TypeScript checking passed.
- Frontend suite passed: 50 files, 259 tests, including paired theme contrast
  and typography contracts.
- Production Control image built successfully and the local Control deployment
  completed its rollout. Worker was not restarted by this review.
- Real desktop Project Overview, Account appearance controls, and Vector
  Database browser were inspected. The directory panel fills its workspace;
  the inspected 1280 px page had no horizontal overflow. Workspace text resolved
  to Hanken Grotesk with the actual variable CJK fallback names.
- Light account controls and dark workspace surfaces were inspected. The theme
  preference was returned to System without saving an account preference change.
- The deployed desktop login was inspected after restoring the default browser
  viewport: blue brand panel, serif statement/title, readable focus treatment,
  and configured SSO action were present.
- No errors were returned by the inspected real workspace tab's console log.
- The isolated fixture exercised the actual shared operation components:
  menu-to-drawer dispatch, light edit and dark delete states, initial focus,
  disabled input/submit/close while pending, retained input after simulated
  failure, successful retry feedback, and Escape/focus restoration.
- Exact resource-name confirmation gated deletion. No resource API mutations
  were performed by the fixture; simulated success does not prove persistence.

## Scope and remaining gaps

The user confirmed that the entire project supports desktop Web only. Mobile
and tablet designs, touch-specific work, and mobile acceptance are out of scope.
This rule is recorded in the root `AGENTS.md` and the canonical Spec. Existing
responsive fallbacks do not imply supported mobile access.

Guard's reviewed source has no complete dark token set; Relay's dark palette is
a family extension, not evidence of an already matching Guard dark release.
Specialist charts/editors, remaining route-local action semantics, and external
provider/storage/runtime mutations still require their own workflow review.
This pass does not certify every route, locale, permission, or System-theme
first-paint transition. Browser captures were inspected during the session;
they are not committed screenshot baselines.
