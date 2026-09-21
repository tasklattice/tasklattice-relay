# Project Runtime Namespaces

TaskLattice Relay maps every Project to one Kubernetes Namespace. The mapping is
stored in PostgreSQL as a `ProjectRuntimeTarget`; Kubernetes remains the runtime
execution target rather than a second product control plane.

## Creation and repair model

Project creation is synchronous:

1. Relay creates the Project and its runtime-target mapping in PostgreSQL.
2. Before returning a successful API response, the Control Plane uses
   server-side apply to ensure that the mapped Namespace exists with the
   Relay-owned labels and annotations.
3. It reconciles the pinned
   official OpenShell Helm chart into that Namespace and waits for readiness.
4. If Namespace or Gateway creation fails, Project creation fails and Relay compensates by
   deleting the new database Project.

The independent Control Worker also reconciles active Runtime Targets in the
background. A PostgreSQL-backed durable queue provides retries, exponential
backoff, delayed execution, and safe work distribution across Worker replicas.
The periodic maintenance task fans out one idempotent job per stale Project;
it does not reconcile the entire platform in one long-running job.

An operator can repair partially created mappings with the
one-shot command packaged in the Control Plane image:

```bash
kubectl -n <control-namespace> exec deployment/<release>-control -- \
  node apps/control/.output/tools/project-runtime-reconcile.mjs
```

The command checks every active Project sequentially, creates or repairs its
Namespace, prints a summary, and exits. It returns a non-zero exit code if any
Project fails. It can also be run from a built source checkout with:

```bash
npm run reconcile:project-runtime --workspace @tali/control
```

PostgreSQL and Kubernetes cannot participate in one atomic transaction. The
Worker therefore treats PostgreSQL as desired state, uses server-side apply,
and records `generation`, `observed_generation`, status, the last error, and
the last successful reconciliation. A stale job cannot mark a newer generation
ready. The periodic Worker or the one-shot command repairs a partial result
after a process or Kubernetes API failure.

## Why this is not a CRD

The current lifecycle is deliberately implemented as database-backed desired
state plus a small Kubernetes adapter. The Project API, authorization, and
audit trail stay in the existing Control Plane. A CRD would add another public
API, RBAC surface, versioned schema, status path, finalizer, webhook/upgrade
story, and source-of-truth decision without adding useful behavior at this
stage.

Introduce a CRD later only if Kubernetes-native clients must create or observe
Projects without going through Relay, multiple controllers need to reconcile
the same target, or GitOps ownership of Project lifecycle becomes a product
requirement. `ProjectRuntimeTarget` already separates desired state from the
Kubernetes adapter, so that migration would not require changing the Project
domain model.

## Namespace identity and scope

New Projects receive a server-generated ID: `tp-` followed by 13 lowercase
Base32 characters, for example `tp-k7m2p5cx4v6dq`. The suffix encodes the
first 65 bits of SHA-256 applied to a random UUID, independently of the Project
name. The resulting 16-character ID is stored as the real Project primary key
and used unchanged for its Kubernetes Namespace and OpenShell Workspace. It is
also the ID used in URLs, ownership, and background jobs. Creation requests
cannot supply an ID. Retrying initialization reuses the same ID and Namespace.

The Namespace also contains:

- `tali.io/project-id` annotation: the exact Project ID used for ownership
  checks.
- `tali.io/project-name` annotation: the exact, human-readable Project name.
- `tali.io/project-name` label: a DNS-safe normalized Project name for listing
  and filtering. Names that cannot be represented as a useful DNS label receive
  a stable hashed fallback.

Labels are discovery metadata, not identity. Relay refuses to adopt or delete
an existing Namespace whose owner annotation does not match the database
mapping. A Kubernetes UID precondition also prevents deleting a Namespace that
was recreated between the ownership check and delete request.

The Project reconciler does not inject a tenant ServiceAccount, `LimitRange`,
or `ResourceQuota`. When the compatibility Gateway topology is enabled, the
official OpenShell chart owns its own ServiceAccount, RBAC, private Service,
NetworkPolicy, StatefulSet, configuration, and persistence in the Namespace.

The main Control Plane ServiceAccount can get, create, and patch Namespaces for
synchronous creation and direct managed-workload operations. The independent
Control Worker has a separate identity that can get, create, patch, and delete
Project Namespaces. Runtime workloads receive neither identity.

## Configuration

Configure Namespace creation under **Platform Setting -> Infrastructure**. The
Helm `projectRuntimeNamespaces` values provide the initial setting for a new
database only; they are not written to `control.toml` and later Helm upgrades
do not replace the saved Platform configuration. The Chart always installs the
reviewed Control and cleanup RBAC so a Platform Administrator can validate and
enable the feature without another deployment.

Before save, validation confirms that the in-cluster Kubernetes API is
available and uses SelfSubjectAccessReview to check the Control
ServiceAccount's required Namespace and managed workload permissions. It also
rejects a cluster ID that differs from any existing Runtime Target.

Runtime Namespace names are derived from the Project ID and are not
configurable. The database enforces uniqueness before Relay creates the
Namespace.

The adapter is in-cluster only. It refuses to create or delete a target whose
stored `cluster_id` differs from the current configuration, preventing an
accidental cluster switch from acting on a same-named Namespace. Moving targets
between clusters requires an explicit data-plane migration.

Project Namespaces and Project Gateway routing are required by the Control
Chart. Test environments use the same topology as UAT.

## Project Gateway topology

### Gateway security contexts

Relay values expose the per-Project Gateway Pod and container security contexts:

```yaml
openshell:
  podSecurityContext:
    fsGroup: 0
  securityContext:
    runAsNonRoot: false
    runAsUser: 0
```

Worker reads these objects from `worker.toml` and passes them to each Project's
OpenShell Helm release during reconciliation. Empty objects retain the bundled
chart defaults; supplied fields override those defaults, including `0` and
`false`. Other Kubernetes security context fields can be supplied in the same
objects. The example requires an SCC that permits the requested UID and group.
Changing values does not grant SCC permissions.

Deploy both the updated Relay chart and updated Control/Worker image. The next
successful Project reconciliation updates the Gateway Deployment's Pod template
and rolls out its Pods. Failed Project initializations still require Retry setup.
These values affect the `openshell-gateway` container and its Pod only: they do
not change the certgen Job or the Agent `Sandbox.spec.podTemplate`. In pinned
OpenShell 0.0.106, the Sandbox driver rejects arbitrary security contexts in
`--driver-config-json`; Gateway settings must not be presented as Sandbox settings.

### Routing and lifecycle

OpenShell 0.0.106 fixes the Kubernetes sandbox Namespace at the Gateway level.
Relay therefore deploys one official OpenShell Gateway release inside every
Project Namespace while retaining one centralized Runner. The Project
Namespace is also the OpenShell workspace. Each Agent operation carries a
typed `{ namespace }` Runtime Target, so lifecycle, observation, audit,
terminal, and service routing all reach the matching Gateway. A `ready`
Runtime Target means both the Namespace and its Gateway release reconciled.

The Gateway is a private, unauthenticated plaintext `ClusterIP` because this
Gateway is restricted to the trusted in-cluster network. Do not
publish it directly. The central Runner service proxy validates the
workspace-qualified hostname and forwards browser traffic to the derived
Gateway Service; it does not trust an endpoint supplied by the caller.

Project deletion uninstalls the official Helm release before deleting the
Namespace. The periodic Worker repairs both resources idempotently. Existing
Agents remain NemoClaw-shaped Sandboxes: the pinned image runs OpenShell as PID
1, `nemoclaw-start` as the long-lived child, and the Agent platform beneath it.
Before each upgrade, the adapter inspects Helm release state. If a Worker
rollout interrupted a prior operation, it rolls the release back to the latest
deployed revision (or removes an incomplete first install) before reconciling
the desired values.

Project Namespaces must follow the `tp-<16-character-base32>` contract.
Control installs one OpenShell Gateway per Project, and the central Runner routes
all business requests by the Project Runtime Target. The Control Chart does not
support a shared Gateway deployment or a fallback to a default workspace.
Upstream OpenShell upgrades keep this Project isolation boundary.
