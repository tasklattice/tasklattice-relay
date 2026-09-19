# Provider and Model interaction alignment

Date: 2026-09-19. Platform: desktop Web only.
Canonical design: [UI interaction Spec](ui-interaction-spec.md).

## Reference and differences

Reviewed the sibling Guard implementation in
`controller/src/components/providers/provider-management-sheet.tsx` and
`controller/src/components/providers/register-models-drawer.tsx`.

| Interaction | Relay before | Updated Relay |
| --- | --- | --- |
| Existing Provider validation | Closed the confirmation drawer on every fulfilled request, including FAILED / DEGRADED responses | Provider details remain open; explicit validation shows checks, message, and returned status; retry stays available |
| Provider inspection | Table identity and action menu only | Click the Provider name to inspect endpoint, stored-credential state, TLS setting, validation, and searchable registered models |
| Additional models | Saved-credential entry existed, but the catalog did not identify already registered models | Register from the Provider details or menu; retain that Provider; mark and disable already registered IDs |
| Selection | Automatically selected the first discovered model; selection only visible inside catalog rows | Explicit selection; independent searchable selected-model list, including manually added IDs, with remove controls |
| Catalog | No search | Case-insensitive name / ID search; filtering never changes selection |
| Async state | Source changes could leave stale discovery; query refetch could reset the entire wizard | Source changes clear discovery and selection; open-session initialization ignores ordinary account refreshes; pending disables navigation and selection |
| Result truthfulness | All-failed results could still say models were registered | All-failed and partially successful results have distinct headings and retain per-model failure details |

Guard's product-specific model profiles, credential editing, and TLS editing
were not copied into Relay. Relay retains its model types/capabilities,
Project/Department scopes, authorization, and LiteLLM validation semantics.

## Interaction contract

- Primary users: scoped Provider and model administrators; read-only users can
  inspect Provider details without receiving mutation controls.
- Provider validation is an explicit action in a right-side drawer. It reuses
  server-held credentials and can probe existing models; HTTP success alone is
  not a validated status.
- Registering from a Provider fixes the account context. Registering from the
  model list allows selecting an existing account; new credentials require
  Provider configuration permission.
- Selected models remain visible independently of the catalog filter. Manual
  IDs can be removed and classified using the same controls as discovered IDs.
- Registered IDs are scoped to the account, including failed registrations.
  Failed existing models should be revalidated, not silently registered again.
- Up to 100 models can be submitted per batch. Pending operations cannot change
  source, selection, step, or close the drawer.
- Registration summaries distinguish successful models from failures. No
  automatic inference or registration runs merely from opening a drawer.

## Verification and limits

- TypeScript check and production build passed. The local Control image was
  rebuilt and the `orbstack` / `tali` Control deployment rolled out successfully.
- Frontend suite: 51 files, 264 tests passed. Added regression coverage for
  account-scoped duplicates, search preservation, manual-ID validation,
  manual selections absent from the catalog, and all-failed result wording.
- The development-only `/ui-review.html` fixture renders the actual Provider
  management and registration components with simulated responses. Desktop
  browser checks covered validation failure/retry, pending controls, existing
  Provider handoff, catalog duplicate blocking, independent searches, manual
  selection, successful batch submission, and summary preservation across a
  simulated Provider query refresh. Light and dark desktop drawers were
  inspected; the second Provider could select IDs registered only in the first.
  The fixture console reported no warnings or errors.
- After deployment, the real Project Provider list and DeepSeek Provider detail
  drawer loaded existing endpoint, validation checks, and registered-model data.
  The validation and registration controls were present; neither was submitted.
- This review did not make real Provider inference or registration calls.
  External credentials, upstream connectivity, and LiteLLM persistence require
  integration verification in the target environment.
