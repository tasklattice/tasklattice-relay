# Troubleshooting runbook

Find the first failing boundary, preserve evidence, and recover without turning an uncertain symptom into a destructive change.

## Triage sequence

1. **Define scope and recent change.** Record affected Projects, roles, Agents, start time, last known-good time, and recent releases or configuration changes. Decide whether the issue is UI, API, database, gateway, or runtime-wide.
2. **Inspect status before restarting.** Capture Pods, rollouts, events, and logs first. A restart can erase the timing and state needed to identify the cause.

   ~~~shell
   kubectl -n <namespace> get pods -o wide
   kubectl -n <namespace> get events --sort-by=.lastTimestamp
   helm -n <namespace> status <release>
   ~~~

3. **Follow the dependency chain.** Control depends on PostgreSQL and configured identity. Agent operations continue through Runner, OpenShell, the Agent Sandbox controller, sandbox images, LiteLLM, and the upstream provider.
4. **Recover the smallest boundary.** Prefer correcting the failed Secret, route, Pod, provider, or Instance over restarting the entire namespace. Verify both technical health and the original user path.

## Symptom guide

### Control UI is unavailable

Check Control rollout, Service endpoints, Route/Ingress, certificate, `control.toml` mount, and PostgreSQL connectivity. A healthy Pod with no endpoints is still unavailable.

~~~shell
kubectl -n <namespace> get deploy/<release>-control svc/<release>-control endpoints/<release>-control
kubectl -n <namespace> logs deployment/<release>-control --since=30m
~~~

### Sign-in fails

Check database reachability and user state. For OIDC, verify issuer discovery, redirect URL, client credentials, certificate trust, and clock skew. Do not reset accounts before preserving the authentication error.

### Instance is stuck provisioning

Inspect the Instance provisioning log, Runner, OpenShell gateway, sandbox resource, controller events, PVC, scheduling, and image-pull Secret. Confirm the desired state before retrying.

~~~shell
kubectl -n <namespace> get sandboxes,pods,pvc
kubectl -n <namespace> logs deployment/<release>-runner --since=30m
kubectl -n <namespace> logs deployment/agent-sandbox-controller --since=30m
~~~

### Model requests fail

Check LiteLLM health and logs, routing status, provider model name, network reachability, quota, and credential metadata. Never paste provider keys into logs or a support ticket.

~~~shell
kubectl -n <namespace> logs deployment/<release>-litellm --since=30m
~~~

If the log repeats `Child process [pid] died` while the Pod itself does not
restart, inspect the configured worker count and cgroup memory counters before
restarting. LiteLLM's Uvicorn workers are processes, not threads, and the
supervisor message omits the child's exit code. A child-only OOM kill can
therefore leave PID 1 and the Kubernetes container running.

~~~shell
kubectl -n <namespace> get deployment/<release>-litellm \
  -o jsonpath='{.spec.template.spec.containers[0].args}{"\n"}{.spec.template.spec.containers[0].resources}{"\n"}'
kubectl -n <namespace> exec deployment/<release>-litellm -- \
  sh -c 'cat /sys/fs/cgroup/memory.events 2>/dev/null || true'
kubectl -n <namespace> top pod -l app.kubernetes.io/component=litellm
~~~

An increasing `oom_kill` counter is direct evidence of a cgroup OOM. The chart
defaults to one worker so a fatal process exit becomes a container termination
that Kubernetes can report. Prefer scaling `litellm.replicaCount`; if multiple
workers per Pod are required, raise the memory limit for each complete Router
and Prisma process.

Disconnected deployments should render
`LITELLM_LOCAL_MODEL_COST_MAP=True`. The `tali-litellm` image validates and uses
the price/context map bundled with its pinned LiteLLM version, so startup does
not need GitHub access. New model metadata or pricing arrives with a new image,
while private model prices should be declared explicitly on the deployment.

### Usage, cost, or audit data is delayed

Confirm request completion, clock and timezone, ingestion services, database writes, selected time range, and attribution identifiers. Keep missing data distinct from a true zero.

## Escalation evidence

- **Include:** version, namespace, timestamps with timezone, affected resource IDs, sanitized error text, Pod states, relevant events, bounded logs, and steps already attempted.
- **Exclude:** passwords, session tokens, provider keys, full `control.toml`, private values, raw personal data, or complete prompts and model responses unless an approved secure channel requires them.

> **Database rollback is not an ordinary application rollback.** Do not downgrade or restore PostgreSQL merely because an application rollout failed. Stop, preserve evidence, check migration compatibility, and use a tested recovery plan with an explicit maintenance window.
