# Approval Interaction Design Spec

Status: Implemented prototype contract

Version: 0.1

Page type: Product Console

Maturity: `prototype`

Interface language: English

Shared visual and operation rules follow the [UI Interactive Spec](../ui-interaction-spec.md).
Persisted changes begin in a right-side operation drawer; resource-specific
secondary actions use the ellipsis menu. This document adds approval semantics,
not alternate shape tokens or mutation surfaces.

## L1 Positioning and Intent

### One-sentence definition

Approval helps requesters submit resource changes that require approval and
continuously understand the current processing step, responsible party, final
decision, and whether the change has actually taken effect.

### Target users

- Requester: Creates, saves, and tracks requests they initiated.
- Reviewer: Reviews requests and makes decisions in a future release; the
  current prototype does not provide approval actions.
- Auditor / Operator: Uses the history to understand decisions and operational
  outcomes; the current prototype displays preview information only.

### Scenarios

- Submit an approval request for an API quota change.
- Submit an approval request for an Instance change.
- Submit an approval request for a Skill binding change.
- View requests that are still waiting for a decision.
- View the history of approved or rejected requests.
- Understand the current request step, current owner, and possible next outcome.

### Non-goals

- The current prototype does not perform real approvals, deployments, or
  resource changes.
- The current prototype does not provide an reviewer inbox, comments,
  reassignment, withdrawal, or resubmission.
- Ticket List does not replace the global Audit; it explains only the request's
  own state flow.
- Approval does not treat an approval decision as proof that the resource was
  deployed successfully.

### Behavioral boundaries

#### Always

- Always display the request status, current step, and current owner.
- Always distinguish `Approved`, `Change applied`, and `Completed`.
- Always explain that preview data is not persisted to the backend.
- Always use the user-facing term `step`, not the internal workflow term `node`.

#### Ask first

- The user must explicitly select `Submit for Approval` to submit a request.
- Reject, Withdraw, and production changes must require confirmation in future
  releases.

#### Never

- Never indicate that a change has taken effect based only on an approval
  decision.
- Never describe a preview action without a connected API as a real success.
- Never show the Requester executable actions that belong only to the Reviewer.
- Never expose credentials, tokens, or raw sensitive configuration in a request
  summary.

## L2 Information Architecture

### Spatial regions

#### Global navigation

The `Approval` group contains:

1. `Raise Request`
2. `Ticket List`

#### Raise Request

- Page Header: Feature positioning and a `UI preview` maturity notice.
- Primary Form: Resource type, environment, target, requested value, and
  business justification.
- Approval Path: Current step, current owner, and next possible outcome.
- Action Area: `Save Draft` and `Submit for Approval`.

#### Ticket List

- Status Tabs: `Pending` and `History`.
- Request List: Request, target, current step or completion time, and status.
- Request Summary: State flow, owner, and outcome explanation for the selected
  request.

### Region boundary rules

- Request List handles selection and does not place approval actions in list
  rows.
- Request Summary explains only the selected request and does not modify other
  list items.
- Approval Path explains state without implying that the backend has persisted
  anything.
- The global Audit handles cross-resource auditing; Ticket List handles only
  request context.

### Content growth rules

- Desktop uses a list or form with a right-hand detail panel; the panel may
  remain visible on wide screens.
- Mobile uses a single-column Header, Tabs, List/Form, Summary order.
- Long target names are truncated, but request ID, status, and current step must
  remain readable.
- Once the request count grows, use pagination or a virtual list instead of
  extending the initial viewport indefinitely.
- Extend request types through type configuration instead of retaining
  irrelevant fields in the generic form.

## L3 Core Flows

### States

#### Request lifecycle

- `DRAFT`: Exists only in the requester's editing context.
- `PENDING`: Submitted and waiting for a decision from the current owner.
- `APPROVED`: Approved, but the change may not have been applied yet.
- `REJECTED`: Rejected; no change will be applied.
- `APPLYING`: A future backend has started applying an approved change.
- `COMPLETED`: The decision and subsequent change outcome are both complete.
- `FAILED`: A future backend failed to apply the change and requires recovery or
  manual intervention.

### Primary flow

1. The user enters `Raise Request`.
2. The user selects Request type, Environment, and Target.
3. The form displays only request fields relevant to the selected type.
4. The user enters a Business justification.
5. The user selects `Submit for Approval`.
6. The page clearly indicates that the request entered `Pending review` and
   displays the current owner.
7. The user goes to `Ticket List / Pending` to track the current step.
8. After a decision, the request moves to `History`.
9. An approved request displays `Change applied` only after the change has been
   applied successfully.

### Branch flows

- Save Draft: Remain on the current page and indicate that the draft was saved
  in the current preview session.
- Rejected: The state flow ends with `Rejected` and `Closed`; Provisioning does
  not appear.
- Approved: Display `Approved` before allowing `Change applied` and `Completed`
  to appear.
- Validation error: Preserve input, locate the invalid field, and explain how to
  fix it.
- Backend error: Preserve input, explain that the request was not submitted, and
  provide Retry.
- Permission denied: Keep the page readable, hide or disable submission, and
  explain the required permission.

## L4 Component Details

### Request Type Select

- Purpose: Determines subsequent fields and approval-path language.
- Default: `API quota change`.
- Change: Clears submission feedback from the old type and switches the relevant
  fields.
- Disabled: Disabled with an explanation when there are no eligible resources or
  the user lacks request permission.
- Error: Displays actionable field-level guidance.

### Request Form

- Purpose: Collects the minimum information required for approval.
- Default: Displays required and type-specific fields.
- Focus: Uses the existing visible `focus-visible` style.
- Loading: Preserves layout and prevents duplicate submission when submission
  takes longer than 300 ms.
- Success: Identifies the step the request entered and who owns it.
- Error: Preserves all input and provides retry.

### Save Draft

- Default: Secondary button.
- Active: Saves the current prototype-session content and displays state
  feedback.
- Disabled: Disabled when there is nothing to save.
- Never: Never indicates server persistence unless the Draft API is connected.

### Submit for Approval

- Default: The page's only primary action.
- Hover / Focus: Uses the Button system states.
- Loading: Prevents duplicate submission and displays clear progress.
- Success: Moves Approval Path to `Pending review`.
- Error: Remains on the form and provides a recovery action.

### Pending / History Tabs

- Default: `Pending`.
- Selected: Uses border and text weight instead of relying on color alone.
- Keyboard: Uses tab semantics and supports standard keyboard focus.
- Empty: Explains that there are no requests in the selected scope instead of
  showing an empty table.

### Request Row

- Default: Displays Request ID, type, target, step/time, and status.
- Hover / Focus: Provides visible row feedback.
- Selected: Uses a left accent line, background, and `aria-pressed` together to
  communicate selection.
- Disabled: The current prototype does not provide row-level mutations.

### Request Summary

- Purpose: Explains the selected request and does not perform approval actions.
- Pending: Emphasizes the current step and Waiting on.
- Approved: Displays the decision and the change-application outcome.
- Rejected: Displays Closed and does not display Provisioning.
- API disconnected: Disables `View Request` and explains why.

## L5 Edge Conditions

### Empty states

- Pending: `No requests are waiting for a decision.`
- History: `No completed requests yet.`
- No selectable Target: Explain that no eligible resources are available and
  direct the user back to the resource list.

### Loading states

- Do not display a flashing loader within 300 ms.
- From 300 ms to 2 s, retain the list/form layout and display a stable
  placeholder.
- After 2 s, identify the object being loaded and provide a comprehensible state
  explanation.
- After 10 s, provide Retry.

### Error states

- Clearly state what failed, what did not change, and whether retry is safe.
- Preserve user input after a submission error.
- Do not clear the last successfully loaded requests after a list error.

### Permission degradation

- No create permission: Allow list viewing, but disable submission and explain
  the permission requirement.
- Own scope only: Pending / History displays only requests initiated by the
  current user.
- Auditor: Read-only access to history and state flows.
- Reviewer: A future release displays role-specific actions in the same Request
  Detail; the current prototype does not fabricate them.

## L6 Acceptance Criteria

### Given / When / Then

#### Create a request

- Given the user is completing an API quota change, when they select
  `Submit for Approval`, then the page displays `Pending review`, the current
  owner, and a clear indication that the change has not yet been applied.
- Given the user switches to Instance change, when the form updates, then RPM/TPM
  fields disappear and Instance-specific change details appear.
- Given the user selects `Save Draft`, when the action completes, then the page
  states that the draft exists only in the current preview session and does not
  claim server persistence.

#### Track a request

- Given the user enters Ticket List, when the default view finishes loading,
  then `Pending` is selected and only unfinished requests appear.
- Given the user selects a Pending request, when Summary updates, then the
  current step and Waiting on match the selected request.
- Given the user switches to History and selects a Rejected request, when the
  state flow appears, then Provisioning and Change applied do not appear.
- Given the user selects an Approved request, when the state flow appears, then
  Approval decision and Change applied are separate steps.

#### Responsive behavior and accessibility

- Given a 390 px viewport, when the Approval page opens, then there is no
  horizontal overflow and the form, list, and details are accessible in
  single-column order.
- Given a keyboard user, when they navigate Tabs, Rows, and Actions, then every
  control has a visible focus state and an understandable name.
- Given any primary action, when its state changes, then the page produces
  visible feedback that assistive technology can read.

### Definition of design completion

- UI copy uses `Approval`, `Request`, `Step`, and `Waiting on`; it does not use an
  ambiguous `Approve` group or the internal term `node`.
- Raise Request and Ticket List use the same state language.
- Preview behavior is clearly labeled and does not claim backend persistence.
- Default, selected, focus, disabled, success, empty, and error states are
  implemented or have explicit gaps.
- Type checking, tests, and the production build pass.
- Desktop and mobile browser checks cover overflow, broken assets, accessible
  names, small targets, console errors, and click feedback.
- The six-dimension Product Console score is complete; the `prototype` total is
  at least 8.0, with no `wrong_domain_logic`, `broken_key_task_path`,
  `disconnected_controls_or_states`, or `subcheck_evidence_missing` blockers.

### Prototype Acceptance Record (2026-07-15)

| Dimension | Score | Evidence |
|---|---:|---|
| Product Intent | 10.0 | The primary task, Requester role, preview non-goals, and primary CTA are clear in the initial viewport. |
| Information Architecture | 9.0 | Raise Request and Ticket List both use a primary region plus Summary; the mobile list includes Target and Current step. |
| System Craft | 8.5 | Reuses the project's Card, Button, Select, StatusDot, and semantic tokens; the primary action reaches 44 px, but a real asynchronous Skeleton is still missing. |
| Trust & Domain Fit | 10.0 | Clearly distinguishes Decision, Change applied, and Completed; the Rejected path does not display Provisioning. |
| Interaction Readiness | 8.5 | Save Draft, Submit, Pending/History, request selection, and the rejection branch all provide feedback; real API error recovery remains for integration. |
| Visual & Brand Expression | 8.5 | Uses restrained console hierarchy, a single primary accent, and consistent state expression without overflow on desktop or mobile. |

Product Console weighted score: `9.21 / 10`.

Prototype blockers: None.

Release gate gaps: Approval API, permission matrix, real loading/error/retry
behavior, empty-data fixtures, and browser-automation evidence for Request Type
branches are not yet connected.
