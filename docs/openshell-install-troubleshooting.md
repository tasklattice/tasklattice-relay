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

For executable upgrade, existing/new tenant, SA/RBAC and cold-pull checks, see
[OCP upgrade and acceptance runbook](ocp-image-pull-upgrade-acceptance.md).

Relay supports dynamic tenant namespaces pulling shared images from one source
namespace. The OCP profile explicitly enables unified tenant image references.
The base Chart and old values without the new setting preserve existing URLs:

```yaml
openshift:
  enabled: true
  imageSourceNamespace: "" # defaults to the Relay release/control namespace
  imageRegistryHost: ""   # defaults to image-registry.openshift-image-registry.svc:5000
  runtimeImages:
    enabled: true
  imagePullReadyTimeoutMs: 120000
```

The Chart resolves Gateway/certgen, Supervisor, default Sandbox, all three platform
Sandboxes, bridge and expert runtime through this source. It preserves the last
repository component and the original tag/digest. Configure the existing component
repository only when a different ImageStream name is needed; Gateway and Supervisor
no longer need separate registry/namespace overrides. Control-plane Pod image URLs
remain controlled by the original `global.imageRegistry` and `images.*` settings.

Populate the corresponding ImageStreams/tags **before** using this profile; the
Chart does not import images. See the [image name/version mapping](../charts/tali-relay/README.md#shared-openshift-images-for-dynamic-tenants).
For an existing mixed-registry deployment, `openshift.runtimeImages.enabled=false`
retains the previous explicit image URLs and cross-namespace authorization. With
`openshift.enabled=false`, ordinary Kubernetes image resolution is unchanged.

Instance-request `sandboxImage` overrides must still use complete accessible
references. Unified mode rejects external Worker/Runner configuration Secrets to
avoid updating only one side. Keep `runtimeImages.enabled=false` and synchronize
both external configurations manually when using these Secrets.
External registries retain their authentication requirements. Worker validates
recognized internal registry references against the authorized source namespace.
Configure `imageRegistryHost` for a custom internal route host, including its port.

After creating/verifying a tenant Namespace, Worker reconciles a RoleBinding in
**the image source namespace** for `system:serviceaccounts:<tenant-ns>` and the
`system:image-puller` ClusterRole. This covers later-created SAs too. Worker verifies
Project ownership, uses a binding name containing the Namespace UID, and does not
force SSA conflicts. The tenant Namespace is the cluster-scoped owner, so GC removes
the binding after tenant deletion. Recreated Namespaces have new owner UIDs.

The chart grants Worker RoleBinding get/create/patch plus bind restricted to
`system:image-puller` in the source namespace. The Worker subject remains in the
Relay installation namespace. Separate installations sharing a source get distinct
Worker authority resource names. Helm/Argo installation credentials must be allowed
to apply these resources in the source namespace. All images in that namespace are
shared with authorized tenant SA groups; place only tenant-consumable images there.

After recovering any interrupted Helm release and before starting the new upgrade,
Worker prepares the existing Gateway, certgen and Sandbox ServiceAccount
names and waits for their internal-registry credentials. Names are preserved so
existing SCC grants, external RoleBindings and Sandbox CRs remain valid. New regular
SAs are precreated with matching Helm release metadata so the chart can adopt them;
Helm continues rendering/managing those SAs on upgrades. Existing SAs are only read,
not rewritten. Worker rejects conflicting Namespace, Project or release ownership.
Regular chart SAs must retain the matching Helm adoption metadata; Namespace ownership
alone cannot override another release's identity.

The patched certgen Job references the prepared SA and no longer recreates it on
each OpenShift upgrade. An existing certgen hook (including one left by an interrupted
install) is recognized by its expected name and pinned chart/release hook metadata.
New certgen SAs have a Namespace owner. Ordinary Kubernetes retains the original
chart-managed SA/hook behavior.

Bridge and Expert Runtime use the tenant's `default` SA and check its credentials
before deployment. Worker never creates or rewrites this platform-owned SA. Explicit
pull-secret names are checked in the tenant namespace and preserved. For internal
images, Worker merges them with the selected SA's current pull-secret references
before passing the list to Pods/Helm/Gateway. This avoids suppressing SA credentials
with an explicit external-registry secret. Private-registry secrets must be provisioned
in each tenant namespace by the platform; Relay does not copy Control credentials.
Secret contents and registry responses are never logged. Waiting is bounded by
`imagePullReadyTimeoutMs` (default 120 seconds, maximum 600 seconds) per preparation
call. Gateway preparation shares one budget across its three SAs. Initializer lease
loss/deletion cancels waiting; Namespace ownership/UID is rechecked during retries.

### Upgrade and existing tenants

Rebuild/deploy the Worker image (which includes the patched OpenShell chart) and
upgrade the Relay chart together. The Chart generates Worker configuration and
Runner image references from the same values. `openshift.imagePullReadyTimeoutMs`
controls the readiness budget; the default is 120 seconds. Interrupted initial
installs are recovered before reading SA credentials, because cleanup can remove
the old SAs and their generated pull Secrets.

Existing ready Projects are selected by periodic reconciliation after the existing
five-minute stale interval; failed Projects need the existing reinitialize action.
New tenants receive authorization during creation. A binding repair alone does not
restart running Pods. Switching source namespaces adds new authorization; remove
old Relay-owned source bindings only after new-source cold pulls succeed. Disabling
OpenShift stops reconciliation but does not automatically revoke existing bindings.
Keep old image tags available through the rollback window.

### Acceptance and diagnosis

On a real OCP cluster verify both a new tenant and an upgraded tenant:

- certgen, Gateway, Bridge, Expert Runtime, all three platform Sandboxes and
  Supervisor init containers can pull images on a node without cached image layers.
- Re-running initialization and upgrading the chart do not recreate prepared SAs.
  Existing SCC grants still apply, and a pre-upgrade Sandbox can recreate its Pod
  using the same SA name.
- Missing pull Secrets, source namespace mismatches, rejected RBAC and expired waits
  identify the tenant, SA and failing stage. Gateway Pod snapshots include image,
  SA and Secret names plus a credential-safe error category (authentication denied,
  authorization denied, image missing, certificate or network failure).
- An unauthorized namespace cannot pull source images. When checking with
  `oc auth can-i --as`, include the impersonated SA's groups, especially
  `--as-group=system:serviceaccounts:<tenant-ns>`: the binding is to that group.
- Switching back to ordinary Kubernetes preserves the original SA/chart behavior.

Local unit/Helm tests validate reconciliation and rendering, not registry reachability,
actual credential validity, cluster CA trust or SCC admission. Successful cold pulls
are the final confirmation. ImageStream API reading and digest resolution are not
required for this shared-source mode and are not implemented by this authorization.
