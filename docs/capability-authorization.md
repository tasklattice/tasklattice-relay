# Role Catalog and Capability Authorization

Status: current implementation snapshot

Last verified: 2026-08-24

This document records the persisted, versioned Role catalog used by runtime
authorization, SSO Group bindings, and Platform Settings. A registered `CAP_*`
identifier is not by itself evidence that its relation resolver, API route, or
business workflow has been implemented.

The built-in catalog contains exactly seven Roles:

- Platform Administrator
- Department Administrator
- Project Administrator
- Agent Developer
- User
- Auditor
- Reviewer

Role IDs and Capability IDs remain stable contract identifiers. Their
Role-to-Capability composition is synchronized from the revisioned catalog into
`role_definitions`, `capability_definitions`, and `role_capability_grants`.
Runtime admission and the read-only Roles & Capabilities page both read those
persisted records.

## Status vocabulary

This document uses the following implementation states:

- **Implemented**: the capability has the required trusted data, relation
  resolution, admission check, and usable API path for its current scope.
- **Partial**: part of the boundary exists, but a relation, operation, or
  workflow needed to use it is missing.
- **Registered only**: the capability is present in the shared registry or a
  role preset but has no direct admission consumer.
- **Route-consumed**: a Project route or system entitlement checks the
  capability. This does not by itself mean a builtin role can reach the route
  or that an approval workflow can complete it.

## Implementation snapshot

| Area | Current repository state |
|---|---|
| Capability registry | 203 unique `CAP_*` identifiers: 18 Platform, 11 Department, 174 Project |
| Admission consumers | 78 capabilities used by Project route policies, plus the system-scoped `CAP_PROJECT_CREATE` entitlement |
| Registered without a direct consumer | 95 capabilities |
| Project route coverage | 73 of 73 current Project route files have an admission declaration; an undeclared Project route fails closed |
| Built-in Role catalog | 7: 3 administration Roles and 4 Project business Roles |
| Persisted Role composition | `RoleDefinition` + `CapabilityDefinition` + `RoleCapabilityGrant`, synchronized by catalog revision |
| Membership values | 5: `admin`, `auditor`, `developer`, `user`, `reviewer` |
| Persisted Role binding | Platform identity, Department membership, and Project membership/assignments remain scope-specific |
| Persisted resource relations | `PROJECT_ANY` and `OWNER` are usable; `MAINTAINER`, `ASSIGNED`, and `SESSION_PARTICIPANT` are not yet backed by their required resource models |
| Memory | 20 capabilities registered; 2 are consumed as conditional checks during Instance creation |
| Approval | `APPROVAL_REQUIRED` admission decision and audit evidence exist; request persistence, review APIs, state machine, and approved-change execution do not |

The 79/95 split is a static snapshot of the current route policy, conditional
Instance-create requirements, and the system Project-create entitlement. It
must be recalculated when routes or the capability registry change.

## Decision path

Project-scoped requests are evaluated as:

```text
authenticated actor
  + scope-specific Role binding
  + persisted Role Capability grants
  + required CAP_* action
  + capability-specific resource relation (Project scope)
  -> ALLOW | DENY | APPROVAL_REQUIRED
```

The implementation layers are:

- [`packages/contracts/src/authorization.ts`](../packages/contracts/src/authorization.ts)
  defines the capability registry, role identifiers, relations, decision
  values, and coarse sensitivity metadata.
- [`apps/control/server/config/builtin-role-catalog.json`](../apps/control/server/config/builtin-role-catalog.json)
  is the revisioned declarative composition for the seven built-in Roles.
- [`apps/control/server/authorization/role-catalog.ts`](../apps/control/server/authorization/role-catalog.ts)
  validates, persists, and reads Role definitions and Capability grants.
- [`apps/control/server/authorization/builtin-roles.ts`](../apps/control/server/authorization/builtin-roles.ts)
  is only a compatibility adapter over the persisted catalog; it contains no
  hard-coded Capability lists.
- [`apps/control/server/authorization/admission-control.ts`](../apps/control/server/authorization/admission-control.ts)
  evaluates grants, relations, and explicit approval requirements.
- [`apps/control/server/authorization/route-capabilities.ts`](../apps/control/server/authorization/route-capabilities.ts)
  maps current Project routes and conditional request content to required
  capabilities.
- [`apps/control/server/middleware/project-capability-admission.ts`](../apps/control/server/middleware/project-capability-admission.ts)
  runs admission before handlers and denies Project routes without a mapping.
- [`apps/control/server/authorization/authorization-context.ts`](../apps/control/server/authorization/authorization-context.ts)
  carries the exact admission evidence into audit processing.

## Built-in Role model

The counts below are generated from catalog revision 1.

| Scope | Binding value | Built-in Role | CAP count | Grant relations |
|---|---|---|---:|---|
| Platform | `platform_administrator` | `ROLE_PLATFORM_ADMIN` | 18 | Not applicable |
| Department | `administrator` | `ROLE_DEPARTMENT_ADMIN` | 11 | Not applicable |
| Project | `admin` | `ROLE_PROJECT_ADMIN` | 171 | `PROJECT_ANY` |
| Project | `developer` | `ROLE_AGENT_DEVELOPER` | 69 | `PROJECT_ANY`, `OWNER`, `MAINTAINER`, `SESSION_PARTICIPANT` |
| Project | `user` | `ROLE_USER` | 9 | `PROJECT_ANY`, `ASSIGNED`, `SESSION_PARTICIPANT` |
| Project | `auditor` | `ROLE_AUDITOR` | 39 | `PROJECT_ANY` |
| Project | `reviewer` | `ROLE_REVIEWER` | 7 | `PROJECT_ANY` |

### Administration scope isolation

Administration Roles do not inherit across scopes. Platform Administrator
grants Platform capabilities only. Department Administrator grants Department
capabilities only. Project Administrator grants Project capabilities only. A
Platform or Department administrator still needs explicit Project membership
before Project admission can succeed.

### Department Administrator

`ROLE_DEPARTMENT_ADMIN` is a first-class built-in catalog entry. It currently
aggregates Department visibility/settings, member view/invite/role assignment/
removal, Project portfolio view/create/delete, and Department quota view/update.
Manual Department membership and verified external SSO grants remain the two
binding sources; both resolve through this same Capability composition.

### Canonical Keycloak Group paths

Group-to-Role bindings use one compact, generated path format. Administrators
select the scope, Department, Project, and stable Role ID; Relay does not accept
an independently typed Group alias.

```text
/tali/r/{roleId}
/tali/d/{departmentId}/r/{roleId}
/tali/d/{departmentId}/p/{projectId}/r/{roleId}
```

The first form is Platform-scoped, the second is Department-scoped, and the
third is Project-scoped. Namespace segments and entity IDs are lowercase;
built-in Role IDs retain their uppercase `ROLE_*` form. Matching against the
verified OIDC `groups` claim is exact and case-sensitive.

### Project Administrator

The Admin preset grants the complete human Project capability catalog. One
administrator can therefore close the loop across Project settings,
membership, Provider credential setup, model registration, Routing creation and
reconciliation, Agent lifecycle, policies, runtime operations, and evidence.
Sensitive capabilities such as Terminal, raw Memory content, and audit export
are included because this role is the Project's accountable operator.

`CAP_APPROVED_CHANGE_APPLY` and `CAP_APPROVAL_OVERRIDE` remain service-only and
are excluded from every human role. A complete grant preset does not imply that
every registered capability has a backing workflow. For example, the Admin
preset contains `CAP_PROJECT_ROLE_CREATE`, `UPDATE`, and `DELETE`, but custom
Role persistence and Role CRUD APIs do not exist, so those capabilities remain
registered only.

Every Project membership has one active Role and may retain multiple explicit
manual or SSO Role assignments. Project identity by itself does not add
Capabilities or inherit a Platform/Department administration Role.

### Auditor

The Auditor preset is the closest to a complete builtin role. It provides
read-only Project, Agent configuration/log, policy, provider/model, audit,
trace, runtime, cost, and usage metadata. Project member names and email
addresses are pseudonymized or masked for this role.

The preset intentionally excludes mutations, Agent interaction, raw Memory or
Session content, sensitive audit bodies, bulk audit export, and Trace content.
Some metadata capabilities, including dedicated Memory index/retention views,
remain registered only because the corresponding APIs do not exist.

### Agent Developer

The Developer preset is intended to manage owned or maintained Agents and to
submit governed changes. `OWNER` is implemented through trusted ownership
columns and same-Project membership foreign keys. Create, delete, configuration
read, interaction, logs, registration/discovery, connection grant/revoke, and
some Instance binding operations have admission paths.

The following advertised Developer areas are not complete:

- `MAINTAINER` has no persisted binding or resolver.
- Instance update, start, stop, restart, and owner transfer have registered
  capabilities but no routes.
- Agent registration update and connection update have no routes.
- Assignment and business Session capabilities have no persistence or routes.
- Most Memory maintenance capabilities have no dedicated API.
- Approval-required changes cannot complete because there is no approval workflow.

Terminal is deliberately limited to Project Administrator because shell access
is effectively a sandbox, credential, and Memory super-capability.

### User

The User preset contains Project view, assigned Agent view/interaction, own
Session operations, and indirect Memory recall. The boundary is narrow by
design: it does not grant Agent configuration, logs, Terminal, audit, direct
Memory content, or Memory search.

The core flow is currently unavailable. There is no Agent Assignment model,
business Session/Participant model, assignment-aware Instance collection, or
Memory partitioning contract. Admission therefore cannot prove `ASSIGNED` or
`SESSION_PARTICIPANT`, and User Agent discovery/interaction remains fail
closed.

### Reviewer

`ROLE_REVIEWER` is a built-in Project business Role with request view,
comment, decide, assign, approval-policy view, and audit view capabilities.
There are no Approval Request APIs or persistence, so only its audit view has a
current route consumer.

Project Administrator also has approval decision capabilities as part of the
complete human capability preset; the eventual workflow must still prohibit
self-approval and preserve separation of duties.

## Capability composition limitations

Built-in Role composition is persisted and is the runtime authorization source,
but assignment storage is still deliberately scope-specific:

- Role and Capability definitions are system-managed and read-only; custom Role
  CRUD is not exposed yet.
- Platform identity uses a Platform administrator binding.
- Department membership stores administrator/member state and can additionally
  be activated by a verified SSO Group grant.
- Project membership and Role assignment storage use the five Project binding
  values.
- Capability evaluation cannot cross a Role's declared authorization scope.
- Several service methods still retain identity/scope checks before evaluating
  the catalog grant. Those checks establish binding scope; they are not a second
  hard-coded Capability list.

The `effectiveCapabilities` returned in Project list responses is therefore a
coarse role-level UI hint. It does not prove the caller's relation to a specific
resource, apply an approval policy, or prove that an API consumer exists. The
server always evaluates the concrete request again.

## Resource relation readiness

Each capability grant owns its relation set; relations are not unioned across
all grants in a role.

| Relation | Status | Current proof |
|---|---|---|
| `PROJECT_ANY` | Implemented | Active membership in the target Project |
| `OWNER` | Implemented | `owner_user_id` on Agent Instance and Project-registered Agent, constrained to a member of the same Project |
| `MAINTAINER` | Registered only | No maintainer binding table or resolver |
| `ASSIGNED` | Registered only | No Agent Assignment table or assignment-aware resolver |
| `SESSION_PARTICIPANT` | Registered only | No business Session or participant persistence |

Platform `BUILT_IN` Agent Garden entries are platform-owned and have no human
owner. Normal Agent and registration updates cannot transfer ownership.
Developer collection reads are filtered to owned records.

## Capability implementation by resource

“Admission entry” means the current code checks the capability on a route or
system entitlement. It does not guarantee builtin-role reachability or a
complete downstream workflow.

| Resource domain | Registered CAPs | Admission entries | Registered only |
|---|---:|---:|---:|
| Project | 15 | 10 | 5 |
| Agent Registration | 5 | 4 | 1 |
| Agent Connection | 4 | 3 | 1 |
| Agent Instance | 19 | 12 | 7 |
| Agent Assignment | 3 | 0 | 3 |
| Agent Session | 7 | 0 | 7 |
| Agent Memory | 20 | 2 | 18 |
| Skill | 10 | 6 | 4 |
| MCP | 8 | 5 | 3 |
| Vector Database | 7 | 4 | 3 |
| Agent Specialization | 4 | 1 | 3 |
| Access Policy | 5 | 5 | 0 |
| Runtime Policy | 5 | 4 | 1 |
| Provider | 7 | 5 | 2 |
| Model Routing | 6 | 5 | 1 |
| Model | 5 | 3 | 2 |
| Inference Gateway | 5 | 1 | 4 |
| Secret | 6 | 0 | 6 |
| Approval | 12 | 0 | 12 |
| Audit | 7 | 4 | 3 |
| Trace | 3 | 2 | 1 |
| Runtime / Operations | 6 | 1 | 5 |
| Cost | 2 | 1 | 1 |
| Usage | 3 | 1 | 2 |
| **Total** | **174** | **79** | **95** |

All 79 consumed capabilities are now present in at least one builtin role.
Project Administrator is the closed-loop operator for every implemented
management path, including Provider, Model, and Model Routing mutations. The
two service-only capabilities (`CAP_APPROVED_CHANGE_APPLY` and
`CAP_APPROVAL_OVERRIDE`) have no human grant and no current route consumer.

## Memory implementation status

Memory and Vector Database are separate resource domains. Memory is
Instance-isolated runtime context; Vector Database represents Project-scoped
built-in or external vector-store content.

All 20 Memory capabilities are registered, but only two are currently consumed
by admission:

| Memory area | CAP count | Current implementation |
|---|---:|---|
| Configuration and embedding binding | 3 | `CONFIG_UPDATE` is required for OpenClaw Instance creation and `EMBEDDING_ASSIGN` is additionally required for Hybrid mode; there is no independent config-update API |
| Item and content operations | 5 | Registered only; no list/read/write/delete/purge API |
| Recall and search | 2 | Registered only; `RECALL_USE` is granted to Developer and User but has no Control interaction path |
| Session indexing | 1 | Registered only; Session persistence and user partitioning are missing |
| Index status, validation, rebuild, and purge | 4 | Registered only |
| Import and export | 2 | Registered only |
| Retention and legal hold | 3 | Registered only |

`CAP_AGENT_MEMORY_RECALL_USE` never implies raw Memory content access. The
current Memory UI reads Memory configuration from the Instance configuration
response, so it is governed by `CAP_AGENT_INSTANCE_CONFIG_VIEW`, not by a
dedicated Memory configuration endpoint.

## Approval behavior

Project has no Environment dimension. Admission never infers policy from
`NODE_ENV`, deployment labels, or a hidden Project property.

The evaluator can return `APPROVAL_REQUIRED` only when the caller supplies an
explicit approval requirement. The requester must hold both the target mutation
capability and `CAP_APPROVAL_REQUEST_SUBMIT`. The result includes a policy
identifier and is written to audit evidence. The current Project route adapter
does not yet attach such a requirement, so this remains an evaluator primitive.

This is a denial boundary, not an approval workflow. The repository currently
has no Approval Request model, request API, review/comment/decision API, state
machine, or `CAP_APPROVED_CHANGE_APPLY` worker. Do not treat
`APPROVAL_REQUIRED` as success when a future policy enables it.

## Audit and sensitive response boundaries

Admission evidence records the capability, role, decision, reason, relation,
resource, and approval policy where applicable. Mutation audit
rows store the primary decision fields and retain the full evidence in metadata.
Denied reads are also audited; ordinary successful high-volume reads are not
automatically added to the mutation audit stream.

Operation outcome and authorization decision are separate. An allowed request
may still fail in the service, while an approval-required request has an
`approval_required` authorization decision and does not execute its mutation.

Agent configuration list/detail responses exclude the browser endpoint URL,
runtime logs, and runtime error details. Those values use separate `no-store`
routes guarded by `CAP_AGENT_INSTANCE_INTERACT` and
`CAP_AGENT_INSTANCE_LOG_VIEW`.

OpenClaw interaction URLs currently contain a runtime gateway credential and
must be treated as bearer credentials. Hermes publishes the predictable
OpenShell service only through the TaskLattice authentication proxy. The
dedicated interaction route asks the Runner to issue a five-minute token bound
to the authenticated user; the proxy accepts it once, removes it from the URL,
and establishes an HttpOnly, same-site Dashboard session. HTTP streaming and
WebSocket traffic cross the same boundary. Deleting or restarting the Sandbox
removes its secret and invalidates every outstanding Hermes token and session.

## Discovery APIs

- `GET /api/v1/projects/{projectId}/authorization/capabilities`
- `GET /api/v1/projects/{projectId}/authorization/roles`
- `GET /api/v1/platform/roles`

The Project routes require `CAP_PROJECT_ROLE_VIEW`; the Platform catalog route
requires `CAP_PLATFORM_ROLE_VIEW`. The Project capability response currently
returns the complete registry without an `implemented` or `reserved` field, and
the Project Role response returns the five Project-scoped built-ins. The
Platform route returns all seven built-ins plus catalog revision and Capability
metadata. Consumers must not
interpret either response as proof that every advertised operation is usable.

## Role identity stabilization

Membership roles now use the canonical values `admin`, `auditor`, `developer`,
`user`, and `reviewer`. There is no compatibility alias for an older generic
membership role and no rollout gate for assigning builtin roles. The final
ownership foreign keys, same-Project constraints, Project authorization
environment, and authorization audit fields remain security properties rather
than compatibility behavior.

`Reviewer` is the fourth Project business Role and the fifth Project-scoped
built-in when Project Administrator is included. Its Capability composition is
authoritative even though the approval workflow needed to exercise every grant
is not implemented yet.

## Verification and missing acceptance coverage

Current tests verify:

- capability identifiers are unique and registered;
- current builtin presets are immutable and exclude selected dangerous grants;
- all 73 current Project route files have an admission policy;
- undeclared nested Project routes fail closed;
- Owner relation proof comes from the database;
- a non-owner Developer is denied;
- User does not receive an inferred `ASSIGNED` relation;
- conditional Instance-create Memory and binding capabilities are enforced;
- admission evidence is carried into audit records.

They currently encode five builtin roles and User fail-closed behavior. They do
not yet provide:

- an exact capability/relation golden matrix for the four intended default
  roles, with Reviewer verified separately;
- a contract that distinguishes implemented from registered-only capabilities;
- a test ensuring every route-consumed management capability is reachable from
  an intended role;
- Assignment, Maintainer, Session, Memory, or Approval end-to-end tests; or
- persisted multi-role/custom-role composition tests.

Other design documents may describe future product personas or approval UX.
For current Project authorization behavior, this document and the code sources
listed under “Decision path” are authoritative.
