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
