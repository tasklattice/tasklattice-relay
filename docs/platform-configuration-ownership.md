# Platform configuration ownership

TaskLattice Relay separates process bootstrap from Platform Administrator
policy. Platform settings are database-owned and audited; deployment settings
provide startup credentials, initial infrastructure values, and deployment-owned
component topology.

Department-owned model, routing, and quota defaults are documented in
[Department Setting](./department-settings.md). They are not Platform fallbacks
and require an explicit Department Administrator role.

## Current boundary

`control.toml` contains bootstrap credentials plus deployment-owned Worker,
Docling connection, Hindsight connection, metrics, and Project provisioner
sections. Control and Worker share this file. Infrastructure sections seed
missing Platform database fields; they never overwrite stored values.
See [Control configuration](control-configuration.md) for the section map.

The Platform database is authoritative for:

- Hermes, OpenClaw, and Deep Agents Sandbox image overrides;
- new OpenShell Sandbox CPU and memory overrides;
- Runtime Namespace deletion timeout;
- Model Provider admission;
- Control internal URL, Runner URL and encrypted token, LiteLLM URL and
  encrypted master key;
- Runtime Namespace enablement and cluster ID;
- Local authentication enablement;
- OIDC enabled state, display name, issuer, Client ID, and encrypted Client
  secret;
- SMTP enabled state, connection metadata, sender identity, and encrypted
  password;
- Departments, people, Department Role bindings, Projects, and Project Role
  bindings;
- the system-managed, revisioned seven-Role catalog and its persisted
  Role-to-Capability grants.

OIDC, SMTP, Sandbox resource overrides, and Runtime deletion policy have no
`control.toml` fallback. Infrastructure settings use TOML as deployment bootstrap: missing database
fields are imported once, while any
stored Platform value wins on every replica and is never overwritten at
restart.

The effective Sandbox image still follows this runtime precedence because the
deployed Runner reports image compatibility:

1. Platform database override;
2. image reported by the deployed Runner;
3. application fallback when neither source is available.

The same precedence applies to CPU and memory for a newly created OpenShell
Sandbox: a Platform database override wins, otherwise the Runner deployment
default reported by its health endpoint is used. OpenShell gateway endpoint,
Workspace, service route base, Kubernetes service CIDRs, Gateway image,
Supervisor image, base image, pull policy, and TLS mode remain deployment-owned.
Platform Setting displays those values read-only so Platform Administrators can
diagnose the active topology without being allowed to mutate cluster bootstrap
configuration. Gateway/Supervisor deployment fields come from
the Worker report derived from `worker.toml`'s `[worker.project_openshell]`; Runner execution fields come from
`runner.json` and are reported by its health endpoint.

## Secrets and live updates

OIDC Client secrets, SMTP passwords, Runner tokens, and LiteLLM master keys are
encrypted with AES-256-GCM using domain-separated keys derived from
`auth.secret`. APIs return only whether a secret is configured. Keep
`auth.secret` stable across every Control replica. Rotating it makes stored
Platform secrets unreadable; plan to replace all four secret types after
rotation.

Security changes must keep Local authentication or SSO enabled. The complete
draft must pass Local credential checks and, for enabled SSO, Discovery and
JWKS validation before it can be saved. Better Auth checks the shared revision
before authentication requests and rebuilds its configuration without a
process restart.

Infrastructure changes must pass live Control, Runner, and LiteLLM probes.
Enabling Runtime Namespaces additionally verifies the Control ServiceAccount's
Kubernetes permissions, and the cluster ID must match every stored Runtime
Target. Validation issues a short-lived token bound to the complete draft,
including secret values; saving a changed or expired draft is rejected.

Runner and LiteLLM clients, the invitation mailer, authentication, and Runtime
Namespace work read the current Platform settings when an operation begins, so
changes are visible to every replica without rewriting a mounted Secret or
restarting Control.

## Requirements for future migrations

Before another setting moves out of `control.toml`, its implementation must:

1. store a revision, actor, and update time;
2. validate the complete configuration before activation;
3. define a single canonical source and an explicit unset behavior;
4. update all replicas consistently or declare that a restart is required;
5. retain a recovery path for authentication and external connectivity;
6. record an audit event without logging secret values.
