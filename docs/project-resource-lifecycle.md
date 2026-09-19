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
States are `pending`, `reconciling`, `retry`, `ready`, `failed`, and `deleting`.
Initialization failures retain the Project and its error. Automatic retries use
the durable queue; after retry exhaustion a Project Administrator can request
`POST /api/v1/projects/{projectId}/initialization/retry`. The Project home page
polls this status and displays the retry action. Instance routing requires a
ready target with an observed generation matching the desired generation.

Agent Garden onboarding, discovery, instantiation and removal return HTTP 202
with `{kind: "resource-operation", operationId, statusUrl}`. The frontend follows
`statusUrl` to obtain completion or failure. These jobs survive HTTP disconnects
and Control restarts. Operation inputs are encrypted using the shared auth key;
only the requester and Project Administrators may read an operation's result.
Worker retries reuse the operation ID for generated runtime identities.

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
Expert Agent and Docling settings. `secrets.existingSecrets.worker` independently
selects an externally managed Worker Secret. Control's configuration schema
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
