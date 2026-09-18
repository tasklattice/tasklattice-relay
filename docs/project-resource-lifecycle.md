# Asynchronous Project resources

Control validates permissions and stores desired state. Worker performs all
Project Namespace/Gateway/Runtime Bridge provisioning and Agent Garden
Kubernetes resource operations. Control never waits for Helm or Pod readiness.

Project creation returns HTTP 201 with the new Project ID and
`initialization.status=pending`. The Project, membership, quotas, policy and
catalog seed records, runtime target and pg-boss job commit in one PostgreSQL
transaction. A queue insertion failure rolls back the entire creation.
Worker synchronizes the LiteLLM Team and then reconciles runtime resources.

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

## Verification

`npm run test:project-initialization:postgres` starts a disposable pgvector
PostgreSQL container, applies every migration and exercises real pg-boss queue
transactions, rollback after queue insertion, initialization failure/retry,
resource-operation encryption and replay, and creation/deletion concurrency.
It does not contact Kubernetes or a production database.
