# Helm component configuration and persistence

Control reads `control.toml`; Worker shares that core configuration and additionally
reads its own `worker.toml` through `TALI_WORKER_CONFIG`. Hindsight has one independent
`config.json`; Runner has `runner.json`; Docling uses its native `config.yaml`. Helm still owns replica
counts, images, Service/RBAC definitions, resource limits and PVCs. File content
is generated from values rather than manually duplicating service names.

| Component | File / Kubernetes source | Runtime use |
| --- | --- | --- |
| Control | `/etc/tali/control.toml`, `<release>-control-config` Secret | Credentials, infrastructure bootstrap, memory and metrics |
| Control Worker | Shared core file plus `/etc/tali-worker/worker.toml`, `<release>-worker-config` Secret | Worker settings, provisioners and Docling |
| Docling | `/etc/docling/config.yaml`, Docling ConfigMap | Native parser limits, model path and engine settings |
| Hindsight API / Worker / migration | `/etc/hindsight/config.json`, `<release>-hindsight-config` Secret | Common provider settings plus process-specific sections |
| Hindsight Project Router | Same Hindsight file | `router` section; local health URL is process-specific |
| LiteLLM | `/etc/litellm/config.yaml`, `<release>-litellm-config` Secret | Existing upstream configuration; custom CA trust is mounted separately |
| Runner | `/etc/tali-runner/runner.json`, `<release>-runner-config` Secret | Authentication, Gateway routing, service proxy, Sandbox images/resources/timeouts |
| PostgreSQL | `<release>-postgresql-config` Secret | Upstream initialization credentials and bootstrap admin URL |
| Monitoring | `<release>-metrics-config` Secret | ServiceMonitor bearer token |
| Keycloak (optional) | `<release>-keycloak-config` Secret | Development identity provider credentials |

Hindsight 0.9.2 uses environment-based upstream settings. The small Python
launcher reads JSON, selects `api`, `worker`, or `migration`, then uses `exec`
to start the upstream executable. It does not use shell evaluation or dotenv
interpolation, so quotes, newlines, dollar signs and backslashes in secrets are
preserved. The router reads its section directly. Hindsight receives neither
Control's auth secret nor the LiteLLM master key.

Docling natively supports YAML, but the pinned image sets an artifacts-path
environment override. The container unsets that override before starting the
CLI, allowing the file's path to take effect. `UVICORN_*`, `DOCLING_DEVICE` and
`DOCLING_NUM_THREADS` remain upstream process/accelerator environment settings;
they are not fields supported by Docling Serve's YAML settings class.

## Configuration ownership

`server.internal_url`, `[runner]`, `[litellm]` and `[runtime_namespaces]` provide
initial values for missing Platform database fields. Saved Platform Settings
remain authoritative and are never overwritten by a restart. SSO and SMTP
remain database-owned. All other deployment sections are read directly from
the file and take effect after a rollout.

Control and Worker retain only process/bootstrap environment (`TALI_CONFIG`, `TALI_WORKER_CONFIG` for Worker,
`PORT`, Kubernetes discovery, CA path and cache locations). The old business
environment overrides and `control.extraEnv` / `control.worker.extraEnv` are
removed. The old administrator password alias is rejected. Use
`secrets.initialPlatformAdministratorPassword`.

Changes to generated Control or Hindsight config roll the respective consumers.
The Hindsight migration Job name includes its configuration/launcher checksum,
so an immutable existing Job cannot hide a new migration configuration.
With `secrets.existingSecrets.<component>`, supply that component's file/keys and bump
`global.rolloutRevision` when updating an external Secret; Helm cannot hash
externally managed contents. Mounts expose only the file each component uses.

Project Gateway deployment settings live in `[worker.project_openshell]`:
Gateway/Supervisor images, base image, chart, Agent workspace storage and pull policy.
Tenant TLS/auth remain fixed by the supported Project topology and are validated
by Helm; they are no longer passed to Runner as display-only environment values.
Related provisioners live in `[worker.project_runtime_bridge]`,
`[worker.expert_agent_runtime]`, `[worker.resource_ownership]` and
`[worker.provisioning]`. These sections live only in `worker.toml`.
Control commits desired state and durable jobs, and reads observed state from the
database. It never installs tenant charts or waits for runtime resources. Its
Kubernetes RBAC is read-only for diagnostics. Only Worker has resource mutation
permissions and the provisioner Secret. See [resource lifecycle](project-resource-lifecycle.md).

### Project OpenShell database

Worker reuses the PostgreSQL server from the shared `[database].url`. Each Project
gets a dedicated `openshell_tp_<hash>` database and login. The Project Namespace
contains an `openshell-postgresql` Secret with the upstream chart's `uri` key;
it contains only that Project's login, never the Control database credentials.
Worker installs the pinned chart with `workload.kind=deployment` and
`server.externalDbSecret=openshell-postgresql`. Gateway metadata therefore lives
on the existing PostgreSQL storage; no `openshell-data-*` PVC is created.

Reconciliation reuses credentials and preserves data. Partial provisioning can
be retried. Project deletion uninstalls Gateway before dropping its database and
role, then deletes the Namespace. Only databases/roles owned by this provisioner
are eligible for cleanup. The runtime bridge remains stateless. Agent workspace
PVCs are separate and still use `projectOpenShell.workspace` settings.

The bundled PostgreSQL initialization account already has provisioning rights.
For an external server, `[database].url` must use a direct PostgreSQL connection
with `CREATEDB` and `CREATEROLE` permissions; the provisioner grants itself the
ability to assume each dedicated role. Use a hostname reachable from Project
Namespaces. The chart generates a fully qualified Service hostname by default.
TLS URL parameters are preserved; any referenced client certificate files must
also be available to the Gateway. Do not use a transaction-pooling endpoint for
provisioning, which uses session advisory locks and database DDL.

Backups must include the per-Project databases and roles, plus the Project
Gateway's Kubernetes credential encryption/JWT Secrets. Backing up only the
Control database is not sufficient. This layout targets a fresh installation;
it does not migrate existing Gateway SQLite volumes.


Runner operates Sandboxes through each Project Gateway and serves the runtime
proxy. Its execution parameters therefore belong in `runner.json`; it does not
receive Gateway/Supervisor deployment metadata. Its only chart environment
setting is `TALI_RUNNER_CONFIG`. Legacy `runner.extraEnv` is rejected.

Initialization uses each owning component's exact image reference: Control for
migration/seed, Docling for model seeding, LiteLLM for database waiting and CA
assembly, Hindsight for database bootstrap and migration. Hindsight bootstrap
uses the provider image's `asyncpg`; the PostgreSQL admin Secret is mounted only
in that init container. Unrelated business components retain their own images.

## Document and vector persistence

| Data | Durable owner |
| --- | --- |
| Docling packaged model weights and download cache | Docling models PVC |
| Original document bytes and revisions | PostgreSQL `vector_document_revisions.source_bytes` |
| Parsed document content and vector chunks | PostgreSQL TaskLattice schema / pgvector |
| Ingestion jobs | PostgreSQL Control job queue |
| Hindsight memory and extraction state | Dedicated Hindsight database/schema on the PostgreSQL PVC |
| Project OpenShell Gateway metadata | Per-Project PostgreSQL database on the existing PostgreSQL PVC |

Docling is a parser, not a vector database. Deleting its cache does not delete
uploaded documents or vectors. Back up the PostgreSQL volume/database to
protect those documents, vectors and memories. Docling temporary conversion
scratch remains ephemeral; the Worker persists successful results in PostgreSQL.

A non-root init container seeds the pinned image's model directory into
`/var/lib/docling/models/artifacts`. The main process reads that path and uses
`/var/lib/docling/models/cache` for additional caches. The image hash identifies
the seed revision; a failed copy does not create a completion marker. A Pod
filesystem group gives the model volume write access.

The default single `ReadWriteOnce` claim uses `Recreate`, avoiding an overlapping
rollout that can deadlock on volume attachment. More than one replica with
persistent storage requires `ReadWriteMany` and a supporting storage class.
Set `docling.persistence.existingClaim` to use an operator-managed claim;
`accessModes` must describe that claim. Disabling persistence uses `emptyDir`.

For an external parser:

```yaml
docling:
  enabled: false
control:
  worker:
    docling:
      url: https://docling.internal.example.com
      apiKey: replace-me
```

`hindsight.enabled=false` disables Relay's Durable Memory master switch even
when an allowlist is present. Embedding dimensions must still match existing
Hindsight data; changing them is a data migration, not just a rollout.

## LiteLLM private CA

Use `litellm.caCertificateBase64`: Base64 of one or more PEM certificates.
The previous `litellm.caCertificate` key is rejected rather than interpreted
ambiguously. Generate a values input without shell-dependent Base64 wrapping:

```sh
base64 < company-ca.pem | tr -d '\n' > /tmp/relay-ca.b64
helm upgrade --install tali-relay charts/tali-relay \
  --set-file litellm.caCertificateBase64=/tmp/relay-ca.b64
```

The old chart wrote the provided string literally into `Secret.stringData` and
mounted it over all of `/etc/ssl/certs`. Base64 input therefore became a
non-PEM file, and existing public CA roots were hidden. The revised chart:

1. Checks Base64 round-trip and PEM markers while rendering.
2. Stores the encoded certificate in `Secret.data`, decoded once by Kubernetes.
3. Uses the LiteLLM image in a non-root init container to validate X.509 and
   merge certifi/system roots with the custom bundle on a writable `emptyDir`.
4. Points `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, and `CURL_CA_BUNDLE` at the
   merged file. It never replaces `/etc/ssl/certs` or disables TLS verification.

Bad certificate content fails explicitly in `build-ca-bundle` initialization.
Inspect its logs for the X.509 error. The production CrashLoop report still
requires production Pod logs to establish the exact exit cause; local evidence
confirms the two chart defects and verifies the corrected TLS behavior.

## Verification

```sh
npm run helm:validate:resources
npm run helm:validate:airgap
npm run helm:validate:openshift
npm run helm:validate:dev-defaults
npm run test --workspace @tali/control
npm run test:component-config:containers
npm run test:component-init:containers
npm run test:openshell-database:postgres
```

Container checks run isolated Docker containers with no external network:
real private-CA HTTPS handshakes, public-root preservation, upstream Hindsight
settings for all three process roles, and Docling's actual YAML loader plus
model seeding. `LITELLM_TEST_IMAGE` may select a locally built overlay image.
The init checks create an isolated disposable PostgreSQL container, run bootstrap
and migrations twice, and verify credentials, extensions and ownership. Neither
check deploys a Helm release or connects to a live database.
