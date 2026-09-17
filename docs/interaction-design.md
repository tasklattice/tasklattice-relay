# TaskLattice Relay Marketplace Interaction Design

Status: Draft

Version: 0.1

UI language: English

> Implementation note: the current 0.2 product slice implements local/OIDC
> login and the authenticated Project console. Its
> concrete visual, responsive, navigation, authentication, accessibility, and
> evidence-gate rules are defined in [UI Interactive Spec](ui-interaction-spec.md).
> The broader marketplace information architecture below remains the product
> direction; disabled `Later` navigation items do not claim those workflows are
> already available.

## 1. Purpose

This document defines the user-facing information architecture, page behavior, workflows, status language, feedback, and interaction rules for the TaskLattice Relay Marketplace.

The product supports three user goals:

1. Discover an existing AI Service and request quota.
2. Approve or manage quota requests.
3. Create an Agent and load approved Skills into the running Agent.

The product does not expose upstream infrastructure or deployment controls. Users work with Service Offerings, Quota Grants, Agents, and Skills.

## 2. Interaction principles

### 2.1 Start from user intent

The UI begins with:

- Use an AI Service.
- Create an Agent.
- Add a Skill to an Agent.
- Review a request.

Infrastructure terminology is limited to administrative pages.

### 2.2 Show desired and actual state separately

Agent and Skill pages distinguish:

- Desired state: what the user requested.
- Runtime state: what the running Agent reports.

An approved request is not shown as active until provisioning or runtime activation succeeds.

### 2.3 Make quota understandable

Quota is presented in user-facing units such as RPM, TPM, monthly tokens, concurrency, and budget. Every quota form shows:

- requested value;
- policy default and maximum;
- current project usage;
- estimated monthly cost;
- approval requirement;
- validity period.

### 2.4 Keep approval in context

Requester and reviewer open the same request detail page. Available actions change by role and current approval step.

### 2.5 Protect high-impact actions

High-impact actions use explicit confirmation and approval policy based on the
operation and resource. Project has no Environment mode or hidden production
context.

### 2.6 Progressive disclosure

Primary forms show only required decisions. Advanced provider, gateway, runtime, and permission detail appears in expandable sections.

## 3. Roles and visible capabilities

| Role | Main capabilities |
|---|---|
| Requester | Browse Services, request quota, create Agents, bind Skills, view own usage |
| Reviewer | Review requests, approve, adjust quota, reject, request changes |
| Service Owner | View Service health and manage Endpoint integration metadata |
| Skill Publisher | Publish Skill versions and view validation results |
| Agent Operator | Inspect runtime operations and resolve failures |
| Platform Administrator | Register Endpoints, publish Offerings, manage policies and adapters |
| Auditor | Read-only access to requests, actions, runtime events, and usage |

The navigation hides sections the current user cannot access. Deep links still return an authorization page rather than silently redirecting.

## 4. Global information architecture

~~~text
PROJECT
└── Overview

AI SERVICES
├── Browse Services
├── Request Quota
└── My Quotas

AGENTS
├── Create Agent
├── Running Agents
└── Agent Details

SKILLS
├── Skill Catalog
├── My Skill Requests
└── Skill Details

APPROVAL
├── My Requests
├── Pending Requests
└── To Approve

USAGE & COST
├── Usage Dashboard
└── Cost Explorer

PLATFORM ADMIN
├── Service Registry
├── Endpoint Integrations
├── Service Offerings
├── Quota Policies
├── Runtime Policies
├── Skill Registry
└── Provider Adapters
~~~

## 5. Global shell

### 5.1 Header

The header contains:

- TaskLattice Relay Marketplace logo and home link;
- global search;
- environment context selector;
- notifications;
- help;
- current user and role menu.

Global search covers:

- Service Offerings;
- Quota Requests and Grants;
- Agents;
- Skills;
- approval request IDs.

Search results are grouped by type and always show their owning Project.

### 5.2 Project context

The current Project is always visible in the header and included in page URLs
and breadcrumbs. Switching Project reloads Project-scoped data, and unsaved
forms prompt before switching.

### 5.3 Page header

Every detail or form page includes:

- breadcrumb;
- page title;
- one-sentence purpose;
- environment badge;
- status badge where applicable;
- primary action;
- overflow actions for secondary operations.

### 5.4 Persistent action bar

Long forms use a bottom action bar:

~~~text
Cancel | Save Draft | Primary Action
~~~

Primary action labels are specific:

- Submit Quota Request
- Create Agent
- Load Skill
- Approve Request

Avoid generic labels such as Submit or Confirm.

## 6. Project

### 6.1 Purpose

The current Project is a role-aware resource boundary, not an infrastructure
dashboard.

### 6.2 Summary cards

Requester view:

- Active Quota Grants;
- Running Agents;
- Loaded Skills;
- Current Month Usage or Cost.

Reviewer additions:

- Requests Waiting for You;
- Requests Due Soon.

Operator additions:

- Unhealthy Endpoints;
- Degraded Agents;
- Failed Skill Loads.

### 6.3 Quick actions

~~~text
1. Browse AI Services
2. Request Quota
3. Create Agent
4. Load a Skill
~~~

Create Agent is disabled when the project has no active Quota Grant. The disabled control explains:

~~~text
An active AI Service quota is required before creating an Agent.
~~~

### 6.4 Recent activity

The activity list combines:

- quota request status changes;
- Grant activation or expiration;
- Agent runtime changes;
- Skill load, upgrade, rollback, and unload events.

Each row includes time, Project, resource, action, actor, status, and a detail link.

## 7. Browse Services

### 7.1 Service list

The default view is a table for enterprise comparison.

Columns:

| Column | Content |
|---|---|
| Service | Name, provider icon, short description |
| Capabilities | Chat, Embedding, Rerank, Image, Audio, or Custom |
| Availability | Available, Limited, Degraded, Unavailable |
| Quota | Current project Grant summary or No active quota |
| Usage | Current window usage when a Grant exists |
| Actions | View Details, Request Quota |

Filters:

- search by service or provider;
- capability;
- environment;
- availability;
- provider;
- quota status.

### 7.2 Availability behavior

| State | Request Quota behavior |
|---|---|
| Available | Enabled |
| Capacity Limited | Enabled with warning |
| Degraded | Policy-controlled; warning shown |
| Unavailable | Disabled |
| Suspended | Disabled |
| Retired | Hidden by default; historical view only |

### 7.3 Empty states

No results:

~~~text
No AI Services match these filters.
Clear filters or search with a different term.
~~~

No Services configured:

~~~text
No AI Services are available in this environment.
Contact the platform team for integration status.
~~~

The user is not offered any flow for importing or deploying a service.

## 8. Service detail

### 8.1 Header

Shows:

- Service name and provider;
- environment;
- availability and health;
- owner team;
- Request Quota primary action.

### 8.2 Sections

Overview:

- description;
- supported operations;
- input/output contract;
- data-handling classification;
- documentation and support link.

Access and quota:

- default policy;
- supported quota dimensions;
- project current Grant;
- current usage;
- expiration;
- Request Increase action.

Reliability:

- recent availability;
- latency summary;
- latest incidents or degraded status;
- last successful health validation.

Cost:

- pricing unit;
- estimated cost examples;
- current project cost when accessible.

Administrative integration details are hidden from normal users. Upstream URL and credentials are never displayed.

## 9. Request Quota

### 9.1 Entry points

- Service list row action.
- Service detail primary action.
- Project quick action.
- My Quotas Request New Quota.

When entered without a selected Service, Step 1 asks the user to choose an Offering.

### 9.2 Form structure

Step 1 — Service and project:

- Service Offering;
- environment;
- project;
- owner team;
- cost center.

Step 2 — Usage:

- use case;
- expected consumers;
- data classification;
- expected traffic pattern;
- requested start and end date.

Step 3 — Limits:

- only dimensions supported by the Offering;
- policy default, maximum, and current project usage;
- requested values;
- estimated monthly cost.

Step 4 — Review:

- complete request summary;
- policy warnings;
- required reviewers;
- expected next steps.

### 9.3 Inline validation

Examples:

~~~text
Requested TPM exceeds the standard policy maximum of 500,000.
You may continue, but additional capacity approval will be required.
~~~

~~~text
This Service is not approved for Restricted data.
Select a compatible Service or change the declared data classification.
~~~

### 9.4 Submission result

~~~text
Quota request submitted
Request QR-2026-0042 is waiting for Capacity Approval.
~~~

Actions:

- View Request
- Return to Services

## 10. My Quotas

### 10.1 Grant table

Columns:

- Service;
- environment;
- project;
- granted limits;
- usage;
- budget;
- effective date;
- expiration;
- status;
- actions.

### 10.2 Usage presentation

Each limited dimension uses:

- numeric used / granted value;
- percentage bar;
- time window;
- last updated time.

Threshold language:

| Usage | Presentation |
|---|---|
| Below 70% | Neutral |
| 70–89% | Warning |
| 90–99% | High usage |
| 100% | Exhausted |

Telemetry delay shows:

~~~text
Usage data is delayed.
Last confirmed at 14:35 UTC.
~~~

The display never implies that delayed telemetry resets quota.

### 10.3 Grant actions

- View Usage
- Request Increase
- Request Extension
- Revoke Access

Actions create auditable requests; they do not silently mutate the Grant.

## 11. Approval experience

### 11.1 Common layout

Two-pane desktop layout:

- left: request queue;
- right: selected request detail.

Mobile and narrow layouts use queue then detail navigation.

### 11.2 Request detail

Header:

- request ID and title;
- current role;
- status;
- due date;
- actions.

Sections:

- Request Summary;
- Requested vs Policy vs Granted;
- Usage and Cost Context;
- Risk and Data Classification;
- Approval Timeline;
- Comments;
- Related Service, Grant, Agent, or Skill;
- Audit Events.

### 11.3 Quota approval actions

~~~text
Approve as Requested
Approve with Adjusted Quota
Request Changes
Reject
~~~

Approve with Adjusted Quota opens an editable comparison table:

| Dimension | Requested | Policy | Granted |
|---|---:|---:|---:|
| RPM | 1,000 | 800 | editable |
| TPM | 500,000 | 400,000 | editable |
| Concurrency | 30 | 20 | editable |
| Monthly Budget | $5,000 | $4,000 | editable |

The reviewer must provide a reason when a granted value differs from the request.

### 11.4 Confirmation

Approval confirmation:

~~~text
Approve this quota request?
The Grant will become usable after gateway policy provisioning succeeds.
~~~

Rejection requires a reason and clearly states that no access will be provisioned.

### 11.5 Same-page requester view

Requesters see the same request detail without approval controls. When changes are requested, fields requiring attention are highlighted and Resume Editing becomes the primary action.

## 12. Create Agent

### 12.1 Preconditions

The user must have:

- permission to create an Agent in the project;
- at least one active Grant in the selected environment;
- access to an allowed Agent Runtime Profile.

### 12.2 Form structure

Step 1 — Basic information:

- Agent name;
- description;
- project;
- owner team;
- environment.

Step 2 — AI Service access:

- select one or more active Grants;
- select allowed operations per Grant;
- show current usage and expiration.

Step 3 — Runtime:

- Runtime Profile;
- availability mode;
- Agent system instruction;
- non-secret configuration;
- secret references.

Step 4 — Initial Skills:

- optional selection of approved Skills;
- compatibility and permission preview;
- each selection creates a Skill Binding.

Step 5 — Review:

- Agent summary;
- Service access;
- initial Skills;
- permission summary;
- approval requirements.

### 12.3 Conflict and policy feedback

~~~text
This quota expires before the requested Agent end date.
Choose another Grant or shorten the Agent lifetime.
~~~

~~~text
Skill “Data Export” requires write access that is not allowed in this project.
~~~

### 12.4 Creation progress

After Create Agent:

~~~text
Creating Agent
1. Request accepted
2. Runtime instance created
3. Agent started
4. Service identity issued
5. Health verification
~~~

The page updates from operation events and can be safely closed. Returning to the Agent shows current progress.

## 13. Agent detail

### 13.1 Header

- Agent name;
- environment;
- RUNNING, DEGRADED, STOPPED, or FAILED;
- runtime profile;
- owner;
- Start or Stop primary action;
- Load Skill secondary action.

### 13.2 Summary cards

- Runtime Health;
- Bound Services;
- Loaded Skills;
- Calls Today;
- Current Cost.

### 13.3 Tabs

Overview:

- desired and observed revision;
- last heartbeat;
- runtime endpoint visibility;
- recent events.

AI Services:

- bound Grant;
- permitted operations;
- usage;
- expiration;
- identity status.

Skills:

- Skill name and requested version;
- desired state;
- observed version and state;
- load strategy;
- health;
- actions.

Operations:

- create, start, stop, identity rotation, Skill load, rollback, unload;
- attempt count;
- duration;
- sanitized failure details;
- correlation ID.

Audit:

- user and system actions.

### 13.4 Desired/observed mismatch

Example:

~~~text
Update in progress
Desired Skill version: 1.3.0
Running Skill version: 1.2.0
~~~

A mismatch is not shown as completed until runtime confirmation is received.

## 14. Skill Catalog

### 14.1 List

Columns or card fields:

- Skill name;
- publisher;
- category;
- latest approved version;
- compatible Agent runtimes;
- permission summary;
- lifecycle state.

Filters:

- category;
- publisher;
- runtime compatibility;
- side effects;
- required service capability;
- approval status.

### 14.2 Permission indicators

Use explicit labels:

~~~text
Reads secrets
External network access
External write
Code execution
Uses AI Service quota
~~~

Color is supplementary; labels and icons carry meaning.

## 15. Skill detail and Load Skill

### 15.1 Skill detail

Sections:

- purpose and examples;
- version history;
- compatible runtimes;
- configuration schema;
- service capabilities;
- secret requirements;
- network access;
- side effects;
- validation results;
- publisher and support.

Primary action: Load into Agent.

### 15.2 Load flow

Step 1 — Agent:

- choose a compatible running Agent;
- show environment and health.

Step 2 — Version:

- choose approved Skill Version;
- show compatibility and change notes.

Step 3 — Configuration:

- schema-driven fields;
- secret references;
- validation.

Step 4 — Permissions:

- compare Agent existing permissions with the new combined permission set;
- highlight newly introduced access.

Step 5 — Review:

- selected Agent and version;
- load strategy;
- expected interruption;
- approval requirement;
- rollback behavior.

### 15.3 Runtime progress

~~~text
Loading Skill
1. Package verified
2. Configuration resolved
3. Skill prepared
4. Skill activated
5. Health check passed
~~~

For ROLLING_RESTART:

~~~text
This Agent runtime cannot hot-load Skills.
A new runtime revision will be started and traffic will switch after health checks pass.
~~~

### 15.4 Failure and rollback

Successful rollback:

~~~text
Skill activation failed
The Agent remains healthy and Skill version 1.2.0 was restored.
~~~

No previous version:

~~~text
Skill activation failed
The Skill was not added. The Agent remains running.
~~~

Required Skill failure:

~~~text
Required Skill unavailable
The Agent is marked Degraded and has been removed from traffic.
~~~

Actions:

- View Operation
- Retry
- Edit Configuration
- Contact Support

## 16. Status language

### 16.1 Quota

| Internal status | UI label |
|---|---|
| DRAFT | Draft |
| SUBMITTED | Submitted |
| PENDING_APPROVAL | Waiting for Approval |
| APPROVED | Approved |
| PROVISIONING | Activating Access |
| ACTIVE | Active |
| PROVISIONING_FAILED | Activation Failed |
| EXPIRED | Expired |
| REVOKED | Revoked |

### 16.2 Agent

| Internal status | UI label |
|---|---|
| CREATING | Creating |
| STARTING | Starting |
| RUNNING | Running |
| UPDATING | Updating |
| DEGRADED | Degraded |
| STOPPING | Stopping |
| STOPPED | Stopped |
| FAILED | Failed |

### 16.3 Skill Binding

| Internal status | UI label |
|---|---|
| QUEUED | Queued |
| PREPARING | Preparing |
| PREPARED | Ready to Activate |
| ACTIVATING | Activating |
| ACTIVE | Active |
| ROLLING_BACK | Rolling Back |
| ROLLED_BACK | Previous Version Restored |
| FAILED | Failed |

Status labels use sentence case in UI. Internal enum names never appear directly.

## 17. Notifications

In-app and optional email notifications:

- request submitted;
- approval required;
- changes requested;
- request approved or rejected;
- Grant activation failed or completed;
- Grant nearing expiration or quota threshold;
- Agent created, degraded, stopped, or failed;
- Skill load completed, failed, or rolled back.

Every notification links to the specific resource and environment.

Notification titles:

~~~text
Quota request approved
Quota access is now active
Agent is running
Skill loaded successfully
Skill version restored after failed update
~~~

## 18. Error and empty-state rules

Errors include:

- what failed;
- what remains safe or unchanged;
- whether retry is safe;
- a correlation ID;
- the next useful action.

Avoid:

~~~text
Something went wrong.
~~~

Prefer:

~~~text
Quota access could not be activated.
The request remains approved, but no gateway access has been issued.
Retry activation or contact the platform team with ID OP-20418.
~~~

Forms preserve user input after recoverable errors.

## 19. Confirmation and destructive actions

Confirmation is required for:

- revoking a Grant;
- stopping or deleting an Agent;
- unloading a required Skill;
- retrying an operation that can interrupt the Agent;
- suspending a Service Offering.

Confirmations name the resource and impact. Typing the resource name is reserved
for irreversible deletion.

## 20. Accessibility and responsive behavior

- Full keyboard operation.
- Visible focus states.
- Labels and descriptions associated with controls.
- Status is never communicated by color alone.
- Tables provide accessible names and responsive card fallback.
- Dialog focus is trapped and restored correctly.
- Live operation updates use non-disruptive status announcements.
- Error summaries link to invalid fields.
- Target WCAG 2.2 AA.

## 21. Interaction acceptance scenarios

### 21.1 Quota

- A user can find a Service, understand its capability, and submit a valid quota request.
- Policy maximum and estimated cost are visible before submission.
- An reviewer can compare requested, policy, and granted values.
- Approved access is not shown as Active until provisioning succeeds.
- Expired and revoked Grants cannot be mistaken for usable access.

### 21.2 Agent

- A user cannot create an Agent without a compatible active Grant.
- Agent creation progress survives page navigation.
- Desired and observed runtime states are distinguishable.
- Service usage is attributable from Agent detail.

### 21.3 Skill

- Only compatible Agents and approved Skill Versions are selectable.
- Newly introduced permissions are visible before confirmation.
- HOT_LOAD and restart behavior are disclosed before load.
- Runtime progress shows prepare, activate, health, and rollback.
- A failed update clearly states whether the Agent and previous Skill remain healthy.

### 21.4 Approval

- Requester and reviewer use the same detail page.
- Role-specific actions are unambiguous.
- Reviewer adjustments require reasons.
- Every decision and runtime outcome is visible in the timeline.

## 22. Open interaction decisions

1. Whether users may switch projects globally.
2. Whether quota forms use direct numeric input, presets, or both.
3. Which approval actions require comments.
4. Whether Agent creation and initial Skill load are one request or sequential requests.
5. Which runtime operations can be cancelled.
6. How long completed operation progress remains prominent.
7. Notification delivery channels and user preferences.
8. Whether Cost Explorer is visible to all requesters or only project owners.
