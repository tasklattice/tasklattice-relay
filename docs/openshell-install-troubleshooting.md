# Project OpenShell installation timeouts

Relay values (seconds):

```yaml
projectOpenShell:
  certgenActiveDeadlineSeconds: 300
  helmTimeoutSeconds: 600
  helmProcessTimeoutSeconds: 2100
```

These map to the same names under `[worker.project_openshell]` in
`worker.toml`. The Worker passes the Job deadline as
`pkiInitJob.activeDeadlineSeconds` to the bundled, patched OpenShell chart.
The Helm timeout covers individual Helm waits, not the whole invocation.
Configuration validation requires Helm's wait to exceed the Job deadline and
the process budget to allow at least three Helm waits plus 60 seconds. This
is a budget policy, not a guarantee for arbitrary custom charts with more hooks.
Deletion keeps its separate existing 2-minute Helm / 150-second process limits.
Interrupted-release rollback uses the configurable Helm/process budgets.
`ttlSecondsAfterFinished: 300` remains a cleanup setting.

Rebuild the Control/Worker image (including `scripts/package-worker-charts.sh`)
and upgrade Relay to deploy this change. Updating Relay values alone with an
old Worker image/chart does not implement the new behavior. If using an existing
Worker config Secret, update its TOML too.

## Failure evidence

Worker emits JSON `openshell.install.resource` records on status changes and
an `openshell.install.failed` record on failure. Search by `attemptId` and
namespace. Resources include UID, creation time and observation time, so
same-name Jobs across retries can be distinguished. The persisted error starts
with the failure layer, attempt and bounded resource summary, before Helm output.

Layers:

- `certgen-job-deadline`: a newly created certgen Job was observed with
  `Failed=True`, `reason=DeadlineExceeded`.
- `helm-wait-timeout`: Helm reported a wait timeout; resource snapshots are
  evidence to investigate, not proof of which resource caused it.
- `worker-process-timeout`: the outer process deadline fired. Worker sends
  SIGTERM, escalates to SIGKILL after 10 seconds, and waits for child close before
  returning, rather than allowing a retry to race Helm.
- `helm-failure-unknown`: another failure; inspect Helm output and snapshots.

Diagnostics poll every two seconds while Helm runs, plus a final collection.
They retain up to 80 resource identities even after atomic rollback removes
resources. Changed states are logged before being replaced by newer states.
Each collection requests at most 100 resources of each kind in the project
namespace: Pods (including init containers), Jobs, Deployments, PVCs and warning
Events. API calls have a five-second abort deadline; individual failures do not
replace the original Helm error. Existing Worker RBAC already permits these reads.

This is best-effort evidence: resources created and deleted between polls can
be missed, and large namespaces are sampled. Namespace snapshots may include
unrelated workloads; correlate Pod owner references and Job UIDs before assigning
blame. Retained old Job failures do not classify a new install attempt.

For safety diagnostics omit free-form API/event messages and container logs,
Secrets, environment variables and workload specs. They retain machine-readable
reasons, exit codes, readiness and warning event resource references. For more
detail, inspect the affected resource with `oc describe` under operator access;
do not paste credentials into logs. Helm's original output remains in the error.

Increasing waits can help slow scheduling/image pulls, but does not fix
unauthorized registries, invalid security contexts or unbindable PVCs.

## OpenShift cross-namespace ImageStream pulling

Use the existing switch; no separate values flag is required:

```yaml
openshift:
  enabled: true
```

Helm generates `[worker.openshift]` with `enabled = true` and
`imageSourceNamespace` set to the Relay release namespace. Worker initialization
creates/verifies the tenant Namespace, then reconciles a RoleBinding **in the
control-plane namespace**, before installing Gateway (including certgen) or
runtime bridge workloads. This is equivalent to:

```sh
oc policy add-role-to-group system:image-puller \
  "system:serviceaccounts:${tenant_ns}" -n "$control_ns"
```

The binding grants only that tenant's ServiceAccount group the built-in
`system:image-puller` ClusterRole in the source namespace. It covers future
ServiceAccounts too. Worker applies a deterministic binding per tenant Namespace
UID, verifies ownership of existing bindings, and does not force SSA conflicts.
The cluster-scoped tenant Namespace is the owner, so Kubernetes garbage collection
removes the binding when that Namespace is deleted. A recreated Namespace uses a
new binding name/owner UID. Manually created bindings are not removed or adopted.

Helm also installs a Role and RoleBinding for the Worker in the source namespace:
RoleBinding get/create/patch plus `bind` restricted to `system:image-puller`.
There is no new cluster-wide `bind` or `escalate` permission. The Helm installer
must have permission to grant this scoped authority. API errors stop initialization
before workload installation and report the source, tenant, role and API status.

Rebuild/deploy the Worker image and upgrade the Relay chart to apply the config
and RBAC together. For existing Projects, trigger initialization/reconciliation
to backfill bindings. If using an externally managed Worker config Secret, mirror
the generated `[worker.openshift]` settings there. Disabling the switch stops
reconciliation; it does not revoke previously granted bindings while their tenant
Namespaces still exist.

This changes authorization only: it does not resolve ImageStream tags, rewrite
Pod image URLs, copy registry credentials, clear explicit `imagePullSecrets`, or
wait for OpenShift's ServiceAccount pull-secret provisioning. Images must already
point to the integrated registry under the control-plane namespace. If pulling
still fails, inspect actual Pod images, SA/pull-secret names and Events. External
registries, new-SA credential races, CA errors and missing tags require separate
fixes. Granting access exposes all ImageStreams covered by `system:image-puller`
in the control-plane namespace to that tenant; use it only for images intended
for Project workloads.
