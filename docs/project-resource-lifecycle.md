# Asynchronous Project resources

Control validates permissions and stores desired state. Worker performs all
Project Namespace/Gateway/Runtime Bridge provisioning and Agent Garden
Kubernetes resource operations. Control never waits for Helm or Pod readiness.

Project creation returns HTTP 201 with the new Project ID and
`initialization.status=pending`. The Project, membership, quotas, policy and
catalog seed records, runtime target and pg-boss job commit in one PostgreSQL
transaction. A queue insertion failure rolls back the entire creation.
Worker synchronizes the LiteLLM Team and then reconciles runtime resources.
After creating the Namespace, Worker provisions a dedicated Gateway database
and login on the existing PostgreSQL server, publishes the Project database
Secret, and installs OpenShell as a Deployment without a Gateway data PVC.

Read progress using `GET /api/v1/projects/{projectId}/initialization`.

### Check Namespace and Reinitialize Project

`GET /api/v1/projects/{projectId}/initialization/check` is a read-only live check
of Project isolation infrastructure. A recent ready Worker publishes a non-secret
desired inventory built from the same Bridge/RBAC generators and packaged Gateway
chart used for initialization. Control compares live resources with that inventory:

- Namespace mapping, ownership, phase and management metadata;
- Gateway and Bridge Deployments, current readiness, Services and configuration;
- complete NetworkPolicy rules, including the current Control Service selector
  and port/targetPort, Sandbox SSH isolation, and OCP DNS rules;
- ServiceAccounts, namespaced and cluster RBAC, required Secret keys and workload
  references, Project Bridge identity and Gateway database identity;
- OCP image-source RoleBinding, tenant SCC grants and image-pull Secret references.

The chart inventory includes all durable Gateway resources; completed certgen Jobs
are transient, while their accounts, grants and output Secrets are checked.
Agent Pods, Sandbox instances, workspace PVCs and business resources are excluded.
These checks verify Kubernetes configuration and infrastructure readiness, not an
exhaustive CNI traffic probe or authenticated Agent business operation.
Missing/drifted resources fail individually; denied API reads, old/missing Worker
reports and unavailable inventory are reported as unavailable, never healthy.
No Secret values are returned. Control gains `get` on Secrets only inside each
owned tenant Namespace via `tali-project-isolation-reader`; its cluster role cannot
read the Control/Worker configuration Secrets.

`POST /api/v1/projects/{projectId}/initialization/reconcile` queues a new generation,
including for a ready Project. Worker reapplies the Namespace, diagnostic RBAC,
OCP grants, Gateway chart and database credentials, Bridge resources and policies.
Manual Reinitialize/Retry wakes an existing queued or backoff-delayed task
immediately, retaining its ID and retry history. A task is inserted only when
none is queued or running. The Project state change and queue wake-up commit
together. Requests during a live initialization lease return HTTP 409 without
changing that generation, lease, or running task. Periodic reconciliation keeps
its normal backoff.
After a Helm upgrade, reinitialize existing Projects to install the diagnostic
Role/RoleBinding and update the Bridge immediately; periodic reconciliation also
repairs eligible Projects. The UI rechecks when that generation completes. Namespace
and diagnostic RBAC ownership conflicts require operator attention; reconciliation
refuses to adopt those resources from another Project.
States are `pending`, `reconciling`, `retry`, `ready`, `failed`, and `deleting`.
Initialization failures retain the Project and its error. Automatic retries use
the durable queue; after retry exhaustion a Project Administrator can request
`POST /api/v1/projects/{projectId}/initialization/retry`. The Project home page
polls this status and displays the retry action. Instance routing requires a
ready target with an observed generation matching the desired generation.

Agent Garden onboarding, discovery, instantiation and removal return HTTP 202
with `{kind: "resource-operation", operationId, statusUrl}`. The frontend follows
`statusUrl` to obtain completion or failure for creation and discovery. These jobs survive HTTP disconnects
and Control restarts. Operation inputs are encrypted using the shared auth key;
only the requester and Project Administrators may read an operation's result.
Worker retries reuse the operation ID for generated runtime identities.

A2A deletion uses one lifecycle for built-in presets, registered containers and
external A2A services. An accepted deletion returns `background=true`,
`accepted=true`, `id`, `status=DESTROYING`, `operationId` and `statusUrl`.
The frontend closes the deletion submission immediately and refreshes inventory;
it does not wait for Kubernetes cleanup. The database tombstone, cancellation of
existing onboarding/discovery/instantiation operations, and cleanup job commit
atomically. Deleting an Instance retains its Agent definition; deleting a
Project-registered definition also deletes its Instances. Built-in definitions
remain platform-managed.

Cleanup has higher queue priority and waits for the active Project lease.
Running creation checks cancellation before resource applies, during readiness
and OCP pull-credential waits, and at database writes. Cancelled job replays are
acknowledged without provisioning. Cleanup can run when the Project runtime
status is degraded, handles missing resources, and records `deletionCompletedAt`
for repeat requests. Only container runtimes trigger Kubernetes deletion;
external endpoints are never deleted. Cleanup failures remain queryable via
`statusUrl` and retain the queue's existing retry policy. A new user-requested
creation gets a new Instance identity, unaffected by retries of an older delete.

No database migration is needed for this A2A change. Worker also applies the
same deletion fence to historical queued deletion operations, and cancels old
creation jobs whose Agent was deleted or whose Instance was deleted after the
job was submitted. Cleanup preserves the original deletion time so a later
explicit replacement survives. New instantiate/discover jobs retain their input
shape with an internal fence version; deletion cancels them under the same
Project lock instead of inferring ordering from timestamps. Both ordinary
container A2A and Demo instances reuse a ready runtime, and retry failed
provisioning using the same Instance identity. Upgrade Control,
Worker and frontend together and drain old Workers before relying on the new
cancellation checks for in-flight work.

Database reads and writes use Prisma model APIs and transactions. Project row
locks are shared through `projects/project-row-lock.ts`; callers keep the lock
and protected writes in the same transaction, acquiring the Project row before
the runtime target row when both are needed. The legacy A2A timestamp comparison
lives in `agent-garden/a2a-lifecycle-queries.ts` to retain PostgreSQL microsecond
precision. These exceptions use parameterized Prisma tagged templates, and the
comparison result is validated at runtime. Business services do not duplicate
these SQL statements.

Deletion first records its tombstone and task atomically. It fences new
provisioning and waits for any active resource lease before external cleanup.
Workers renew leases while running; after a crash, leases expire and durable
jobs can recover. Provisioning checks the generation/tombstone between stages
and cannot publish readiness after deletion. Cleanup is idempotent and handles
partially created resources. The existing deletion grace period remains.
Gateway cleanup uninstalls its Helm release before dropping the Project's
Gateway database and login. A failed uninstall retains database state for retry.

## Deployment

Control and Worker still share core `control.toml` credentials. Only Worker
mounts `worker.toml` (`TALI_WORKER_CONFIG`), with OpenShell, Runtime Bridge,
Expert Agent and Docling settings. Helm renders the Worker configuration and
the bootstrap Job generates the shared Control configuration. Control's configuration schema
rejects the former Worker section. Its cluster role permits only diagnostic
reads; the Worker service account owns resource mutation permissions.

Worker publishes non-secret deployment metadata and verified Kubernetes access
to PostgreSQL every 30 seconds. Control reads that report for Platform Settings;
reports older than two minutes are unavailable. Control needs neither OpenShell
images nor installation parameters to display the deployment.

Deploy the matching application image and chart together. Both Control and
Worker use the Control image; migrations add the Worker report, operation table
and the failed target state. Keep the shared auth key stable so encrypted job
inputs can be decrypted. Never deploy this chart with an older application image.

## Full local development cleanup

`npm run helm:delete:dev` performs a destructive cleanup of the selected Relay
installation, including its development database. It retains the shared `tali`
Namespace (or `HELM_NAMESPACE`) and resources belonging to Guard or other releases.
It does not delete shared CRDs or an independently installed Agent Sandbox controller.

1. Scale this release's Control, Worker and Runner to zero and wait for their
   Pods to exit, so reconciliation cannot recreate tenant resources during cleanup.
2. Discover Relay-managed Project Namespaces again after shutdown. Delete
   Sandboxes while their controller is still available, uninstall tenant Helm
   releases, remove their cluster RBAC, and delete each tenant Namespace with all
   remaining workloads, PVCs, Secrets and Helm release records.
3. Uninstall the main Relay release. Remove its leftover hooks, Secrets, cluster
   RBAC and PVCs, including PostgreSQL and Docling model storage.
4. Wait for the storage provisioner to delete the selected PVs and backing
   storage. Targeted `Retain` volumes are changed to `Delete`; finalizers are
   never stripped. A controller/storage timeout reports failure instead of
   claiming cleanup succeeded. Rerunning the command continues cleanup even
   when the main release is already absent.

New tenant Namespace annotations `tali.io/control-release` and
`tali.io/control-namespace` identify their originating release. Older tenant
Namespaces are recognized by their Relay management labels and Project identity;
if another Relay installation is present and ownership is ambiguous, the command
stops before deleting anything and requests those annotations. Unrelated resources
inside `tali` are never selected using `delete --all`. External databases and
operator-managed resources outside the selected installation are not dropped.

`KUBE_CONTEXT`, `HELM_NAMESPACE`, `HELM_RELEASE_NAME` and `HELM_TIMEOUT` select the
same target as deployment. Use `npm run test:helm-delete:dev` for the mocked CLI
cleanup tests; these do not connect to or change a cluster.

## Verification

`npm run test:project-initialization:postgres` starts a disposable pgvector
PostgreSQL container, applies every migration and exercises real pg-boss queue
transactions, rollback after queue insertion, initialization failure/retry,
resource-operation encryption and replay, and creation/deletion concurrency.
It does not contact Kubernetes or a production database.
