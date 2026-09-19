{{- define "tali.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "tali.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := include "tali.name" . -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end }}

{{- define "tali.componentName" -}}
{{- printf "%s-%s" (include "tali.fullname" .root) .component | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "tali.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: tali
{{- end }}

{{- define "tali.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tali.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "tali.componentLabels" -}}
{{ include "tali.labels" .root }}
app.kubernetes.io/name: {{ include "tali.name" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "tali.argocdSyncWave" -}}
{{- index .root.Values.global.argocd.syncWaves .name -}}
{{- end }}

{{- define "tali.resourceAnnotations" -}}
{{- $annotations := deepCopy (default (dict) .annotations) -}}
{{- $_ := set $annotations "argocd.argoproj.io/sync-wave" (include "tali.argocdSyncWave" (dict "root" .root "name" .wave)) -}}
{{- toYaml $annotations -}}
{{- end }}

{{- define "tali.image" -}}
{{- $registry := trimSuffix "/" .root.Values.global.imageRegistry -}}
{{- $repository := .image.repository -}}
{{- if or (not (hasKey .image "useGlobalRegistry")) .image.useGlobalRegistry -}}
{{- printf "%s/%s:%s" $registry $repository (default .root.Chart.AppVersion .image.tag) -}}
{{- else -}}
{{- printf "%s:%s" $repository (default .root.Chart.AppVersion .image.tag) -}}
{{- end -}}
{{- end }}

{{- define "tali.secretName" -}}
{{- default (include "tali.componentName" (dict "root" .root "component" (printf "%s-config" .component))) (index .root.Values.secrets.existingSecrets .component) -}}
{{- end }}

{{- define "tali.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "tali.componentName" (dict "root" . "component" "control")) .Values.serviceAccount.name -}}
{{- else -}}
{{- required "serviceAccount.name is required when serviceAccount.create=false" .Values.serviceAccount.name -}}
{{- end -}}
{{- end }}

{{- define "tali.runtimeServiceAccountName" -}}
{{- if .Values.serviceAccount.runtime.create -}}
{{- default (include "tali.componentName" (dict "root" . "component" "runtime")) .Values.serviceAccount.runtime.name -}}
{{- else -}}
{{- required "serviceAccount.runtime.name is required when serviceAccount.runtime.create=false" .Values.serviceAccount.runtime.name -}}
{{- end -}}
{{- end }}

{{- define "tali.controlWorkerServiceAccountName" -}}
{{- include "tali.componentName" (dict "root" . "component" "control-worker") -}}
{{- end }}

{{- define "tali.databaseUrl" -}}
{{- if .Values.secrets.databaseUrl -}}
{{- .Values.secrets.databaseUrl -}}
{{- else -}}
{{- printf "postgresql://litellm:%s@%s.%s.svc.cluster.local:5432/litellm" (urlquery .Values.secrets.postgresPassword | replace "+" "%20") (include "tali.componentName" (dict "root" . "component" "postgresql")) .Release.Namespace -}}
{{- end -}}
{{- end }}

{{- define "tali.hindsightServiceName" -}}
{{- include "tali.componentName" (dict "root" . "component" "hindsight-api") -}}
{{- end }}

{{- define "tali.hindsightDatabaseName" -}}
{{- $value := required "hindsight.database.name is required" .Values.hindsight.database.name -}}
{{- if not (regexMatch "^[a-z_][a-z0-9_]{0,62}$" $value) -}}
{{- fail "hindsight.database.name must be a lowercase PostgreSQL identifier" -}}
{{- end -}}
{{- $value -}}
{{- end }}

{{- define "tali.hindsightDatabaseUser" -}}
{{- $value := required "hindsight.database.user is required" .Values.hindsight.database.user -}}
{{- if not (regexMatch "^[a-z_][a-z0-9_]{0,62}$" $value) -}}
{{- fail "hindsight.database.user must be a lowercase PostgreSQL identifier" -}}
{{- end -}}
{{- $value -}}
{{- end }}

{{- define "tali.hindsightDatabaseSchema" -}}
{{- $value := required "hindsight.database.schema is required" .Values.hindsight.database.schema -}}
{{- if not (regexMatch "^[a-z_][a-z0-9_]{0,62}$" $value) -}}
{{- fail "hindsight.database.schema must be a lowercase PostgreSQL identifier" -}}
{{- end -}}
{{- $value -}}
{{- end }}

{{- define "tali.hindsightDatabaseUrl" -}}
{{- printf "postgresql://%s:%s@%s:5432/%s" (include "tali.hindsightDatabaseUser" .) (urlquery .Values.secrets.hindsightDatabasePassword | replace "+" "%20") (include "tali.componentName" (dict "root" . "component" "postgresql")) (include "tali.hindsightDatabaseName" .) -}}
{{- end }}

{{- define "tali.hindsightUrl" -}}
{{- printf "http://%s.%s.svc.cluster.local:%v" (include "tali.hindsightServiceName" .) .Release.Namespace .Values.hindsight.service.port -}}
{{- end }}

{{- define "tali.hindsightSecretChecksum" -}}
{{- $config := include "tali.hindsightConfig" . -}}
{{- if .Values.secrets.existingSecrets.hindsight -}}
{{- $config = printf "existing:%s:%s" .Values.secrets.existingSecrets.hindsight .Values.global.rolloutRevision -}}
{{- end -}}
{{- printf "%s:%s:%s" $config (.Files.Get "files/hindsight-entrypoint.py") (.Files.Get "files/hindsight-bootstrap.py") | sha256sum -}}
{{- end }}

{{- define "tali.hindsightSettings" -}}
- name: HOME
  value: /tmp
- name: PYTHONDONTWRITEBYTECODE
  value: "1"
- name: LITELLM_LOCAL_MODEL_COST_MAP
  value: "True"
- name: HINDSIGHT_API_DATABASE_URL
  value: {{ include "tali.hindsightDatabaseUrl" . | quote }}
- name: HINDSIGHT_API_MIGRATION_DATABASE_URL
  value: {{ include "tali.hindsightDatabaseUrl" . | quote }}
- name: HINDSIGHT_API_DATABASE_SCHEMA
  value: {{ include "tali.hindsightDatabaseSchema" . | quote }}
- name: HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP
  value: "false"
- name: HINDSIGHT_API_VECTOR_EXTENSION
  value: pgvector
- name: HINDSIGHT_API_TEXT_SEARCH_EXTENSION
  value: native
- name: HINDSIGHT_API_TENANT_EXTENSION
  value: hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension
- name: HINDSIGHT_API_TENANT_API_KEY
  value: {{ .Values.secrets.hindsightApiKey | quote }}
- name: HINDSIGHT_API_MCP_ENABLED
  value: "false"
- name: HINDSIGHT_API_LLM_TRACE_ENABLED
  value: "false"
- name: HINDSIGHT_API_LLM_DEBUG_DUMP_4XX
  value: "false"
- name: HINDSIGHT_API_METRICS_INCLUDE_BANK_ID
  value: "false"
- name: HINDSIGHT_API_METRICS_BACKLOG_ENABLED
  value: "true"
- name: HINDSIGHT_API_LOG_FORMAT
  value: json
- name: HINDSIGHT_API_LOG_JSON_FIELDS
  value: severity,message,timestamp,logger
- name: HINDSIGHT_API_LLM_PROVIDER
  value: {{ .Values.hindsight.models.llmProvider | quote }}
- name: HINDSIGHT_API_LLM_BASE_URL
  value: {{ printf "http://127.0.0.1:%v/v1" .Values.hindsight.router.port | quote }}
- name: HINDSIGHT_API_LLM_MODEL
  value: {{ .Values.hindsight.models.llm | quote }}
- name: HINDSIGHT_API_LLM_API_KEY
  value: {{ .Values.secrets.hindsightRouterToken | quote }}
- name: HINDSIGHT_API_LLM_SEND_BANK_AS_USER
  value: "true"
- name: HINDSIGHT_API_EMBEDDINGS_PROVIDER
  value: {{ .Values.hindsight.models.embeddingProvider | quote }}
{{- if eq .Values.hindsight.models.embeddingProvider "openai" }}
- name: HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL
  value: {{ printf "http://127.0.0.1:%v/v1" .Values.hindsight.router.port | quote }}
- name: HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL
  value: {{ .Values.hindsight.models.embedding | quote }}
- name: HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY
  value: {{ .Values.secrets.hindsightRouterToken | quote }}
- name: HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS
  value: {{ .Values.hindsight.models.embeddingDimensions | quote }}
{{- else if eq .Values.hindsight.models.embeddingProvider "litellm" }}
- name: HINDSIGHT_API_EMBEDDINGS_LITELLM_API_BASE
  value: {{ printf "http://127.0.0.1:%v" .Values.hindsight.router.port | quote }}
- name: HINDSIGHT_API_EMBEDDINGS_LITELLM_MODEL
  value: {{ .Values.hindsight.models.embedding | quote }}
- name: HINDSIGHT_API_EMBEDDINGS_LITELLM_API_KEY
  value: {{ .Values.secrets.hindsightRouterToken | quote }}
{{- end }}
- name: HINDSIGHT_API_RERANKER_PROVIDER
  value: {{ .Values.hindsight.models.rerankerProvider | quote }}
{{- if eq .Values.hindsight.models.rerankerProvider "litellm" }}
- name: HINDSIGHT_API_RERANKER_LITELLM_API_BASE
  value: {{ printf "http://127.0.0.1:%v" .Values.hindsight.router.port | quote }}
- name: HINDSIGHT_API_RERANKER_LITELLM_MODEL
  value: {{ .Values.hindsight.models.reranker | quote }}
- name: HINDSIGHT_API_RERANKER_LITELLM_API_KEY
  value: {{ .Values.secrets.hindsightRouterToken | quote }}
- name: HINDSIGHT_API_RERANKER_SEND_BANK_AS_HEADER
  value: "true"
{{- end }}
{{- end }}

{{- define "tali.hindsightConfig" -}}
{{- $common := dict -}}
{{- range (include "tali.hindsightSettings" . | fromYamlArray) -}}
{{- $_ := set $common .name .value -}}
{{- end -}}
{{- $api := dict "HINDSIGHT_API_PORT" (.Values.hindsight.service.port | toString) "HINDSIGHT_API_WORKER_ENABLED" (not .Values.hindsight.worker.enabled | toString) -}}
{{- $worker := dict "HINDSIGHT_API_WORKER_HTTP_PORT" (.Values.hindsight.worker.service.port | toString) "HINDSIGHT_API_DB_MAX_PARALLEL_WORKERS_PER_GATHER" "0" -}}
{{- $router := dict "host" "0.0.0.0" "port" .Values.hindsight.router.port "controlBaseUrl" (printf "http://%s.%s.svc.cluster.local:%v" (include "tali.componentName" (dict "root" . "component" "control")) .Release.Namespace .Values.control.service.port) "controlToken" .Values.secrets.hindsightRouterToken "routerToken" .Values.secrets.hindsightRouterToken "embeddingDimensions" .Values.hindsight.models.embeddingDimensions -}}
{{- dict "common" $common "api" $api "worker" $worker "router" $router "migration" (dict "schema" (include "tali.hindsightDatabaseSchema" .) "embeddingDimensions" .Values.hindsight.models.embeddingDimensions) | toPrettyJson -}}
{{- end }}

{{- define "tali.hindsightRouterContainer" -}}
- name: project-router
  image: {{ include "tali.image" (dict "root" .root "image" .root.Values.images.control) }}
  imagePullPolicy: {{ .root.Values.images.control.pullPolicy }}
  command: ["node", "apps/control/.output/hindsight-router/hindsight-router.mjs"]
  env:
    - name: TALI_HINDSIGHT_CONFIG
      value: /etc/hindsight/config.json
    - name: TALI_HINDSIGHT_LOCAL_HEALTH_URL
      value: {{ printf "http://127.0.0.1:%v/health" .hindsightPort | quote }}
  volumeMounts:
    - name: hindsight-config
      mountPath: /etc/hindsight
      readOnly: true
  ports:
    - name: project-router
      containerPort: {{ .root.Values.hindsight.router.port }}
      protocol: TCP
  readinessProbe:
    httpGet:
      path: /health
      port: project-router
    initialDelaySeconds: 1
    periodSeconds: 5
  livenessProbe:
    httpGet:
      path: /health/live
      port: project-router
    initialDelaySeconds: 5
    periodSeconds: 10
  resources:
    {{- toYaml .root.Values.hindsight.router.resources | nindent 4 }}
  securityContext:
    allowPrivilegeEscalation: false
    readOnlyRootFilesystem: true
    capabilities:
      drop: ["ALL"]
{{- end }}

{{/* Encode structured values as TOML inline tables, preserving types and escaping. */}}
{{- define "tali.tomlValue" -}}
{{- if kindIs "map" . -}}
{ {{- $parts := list -}}{{- range $key, $value := . -}}
{{- $parts = append $parts (printf "%s = %s" ($key | toJson) (include "tali.tomlValue" $value)) -}}
{{- end -}}{{ join ", " $parts }} }
{{- else if kindIs "slice" . -}}
[{{- $parts := list -}}{{- range . -}}{{- $parts = append $parts (include "tali.tomlValue" .) -}}{{- end -}}{{ join ", " $parts }}]
{{- else -}}{{ toJson . }}{{- end -}}
{{- end }}

{{- define "tali.controlConfig" -}}
{{- if hasKey .Values.control "publicUrl" -}}
{{- fail "control.publicUrl was removed; configure control.publicUrls as an origin array" -}}
{{- end -}}
{{- if not .Values.control.publicUrls -}}
{{- fail "control.publicUrls must contain at least one allowed origin" -}}
{{- end -}}
{{- if not (kindIs "slice" .Values.control.publicUrls) -}}
{{- fail "control.publicUrls must be an array of HTTP(S) origins" -}}
{{- end -}}
{{- range .Values.control.publicUrls -}}
{{- if not (kindIs "string" .) -}}
{{- fail "control.publicUrls entries must be HTTP(S) origins" -}}
{{- end -}}
{{- if not (regexMatch "^https?://[^/?#@*[:space:]]+/?$" .) -}}
{{- fail "control.publicUrls entries must be HTTP(S) origins without paths, credentials, queries or fragments" -}}
{{- end -}}
{{- end -}}
schema_version = 1

[server]
public_urls = {{ .Values.control.publicUrls | toJson }}
trust_proxy_headers = {{ .Values.control.trustProxyHeaders }}
internal_url = {{ printf "http://%s.%s.svc.cluster.local:%v" (include "tali.componentName" (dict "root" . "component" "control")) .Release.Namespace .Values.control.service.port | toJson }}

[database]
url = {{ include "tali.databaseUrl" . | toJson }}

[auth]
secret = {{ required "secrets.authSecret is required" .Values.secrets.authSecret | toJson }}

[auth.local]
initial_platform_administrator_username = {{ required "auth.local.username is required" .Values.auth.local.username | toJson }}
initial_platform_administrator_email = {{ required "auth.local.email is required" .Values.auth.local.email | toJson }}
initial_platform_administrator_password = {{ required "secrets.initialPlatformAdministratorPassword is required" .Values.secrets.initialPlatformAdministratorPassword | toJson }}

[runner]
url = {{ printf "http://%s:9090" (include "tali.componentName" (dict "root" . "component" "runner")) | toJson }}
token = {{ .Values.secrets.runnerToken | toJson }}

[litellm]
url = {{ printf "http://%s.%s.svc.cluster.local:4000" (include "tali.componentName" (dict "root" . "component" "litellm")) .Release.Namespace | toJson }}
master_key = {{ .Values.secrets.litellmMasterKey | toJson }}

[runtime_namespaces]
enabled = {{ .Values.projectRuntimeNamespaces.enabled }}
cluster_id = {{ .Values.projectRuntimeNamespaces.clusterId | toJson }}

[metrics]
token = {{ .Values.secrets.metricsToken | toJson }}

[memory]
enabled = {{ and .Values.features.durableMemory.enabled .Values.hindsight.enabled }}
projectAllowlist = {{ .Values.features.durableMemory.projectAllowlist | toJson }}
baseUrl = {{ include "tali.hindsightUrl" . | toJson }}
apiKey = {{ .Values.secrets.hindsightApiKey | toJson }}
routerToken = {{ .Values.secrets.hindsightRouterToken | toJson }}
embeddingDimensions = {{ .Values.hindsight.models.embeddingDimensions }}
recallTimeoutMs = {{ .Values.hindsight.runtimeRecallTimeoutMs }}

{{- end }}

{{- define "tali.workerConfig" -}}
[worker]
healthPort = {{ .Values.control.worker.healthPort }}
role = "tali-control-worker"
[worker.docling]
enabled = {{ or .Values.docling.enabled (not (empty .Values.control.worker.docling.url)) }}
baseUrl = {{ default (printf "http://%s:%v" (include "tali.componentName" (dict "root" . "component" "docling")) .Values.docling.service.port) .Values.control.worker.docling.url | toJson }}
apiKey = {{ .Values.control.worker.docling.apiKey | toJson }}

[worker.resource_ownership]
enabled = {{ .Values.projectRuntimeNamespaces.resourceOwnership }}
sourceTrackingId = {{ .Values.projectRuntimeNamespaces.argocd.sourceTrackingId | toJson }}
installationId = {{ .Values.projectRuntimeNamespaces.argocd.installationId | toJson }}

[worker.project_openshell]
enabled = {{ .Values.projectOpenShell.enabled }}
targetRouting = {{ .Values.runner.projectTargetRouting.enabled }}
chart = {{ .Values.projectOpenShell.helmChart | toJson }}
releaseName = {{ .Values.projectOpenShell.releaseName | toJson }}
serviceNamePrefix = {{ .Values.projectOpenShell.serviceNamePrefix | toJson }}
gatewayImageRepository = {{ .Values.openshell.image.repository | toJson }}
gatewayImageTag = {{ .Values.openshell.image.tag | toJson }}
gatewayResources = {{ include "tali.tomlValue" .Values.openshell.resources }}
imagePullSecrets = {{ include "tali.tomlValue" .Values.openshell.imagePullSecrets }}
imagePullPolicy = {{ .Values.openshell.image.pullPolicy | toJson }}
supervisorImageRepository = {{ .Values.openshell.supervisor.image.repository | toJson }}
supervisorImageTag = {{ .Values.openshell.supervisor.image.tag | toJson }}
supervisorImagePullPolicy = {{ .Values.openshell.supervisor.image.pullPolicy | toJson }}
sandboxImage = {{ .Values.openshell.server.sandboxImage | toJson }}
sandboxImagePullPolicy = {{ .Values.openshell.server.sandboxImagePullPolicy | toJson }}
sandboxImagePullSecrets = {{ include "tali.tomlValue" .Values.openshell.server.sandboxImagePullSecrets }}
workspaceDefaultStorageSize = {{ .Values.projectOpenShell.workspace.storageSize | toJson }}
{{- with .Values.projectOpenShell.workspace.storageClass }}
workspaceStorageClass = {{ . | toJson }}
{{- end }}

[worker.project_runtime_bridge]
enabled = {{ and .Values.projectRuntimeNamespaces.enabled .Values.projectRuntimeBridge.enabled }}
image = {{ include "tali.image" (dict "root" . "image" .Values.images.control) | toJson }}
imagePullPolicy = {{ .Values.images.control.pullPolicy | toJson }}
revision = {{ default .Chart.AppVersion .Values.global.rolloutRevision | toJson }}
imagePullSecrets = {{ include "tali.tomlValue" .Values.global.imagePullSecrets }}
resources = {{ include "tali.tomlValue" .Values.projectRuntimeBridge.resources }}

[worker.expert_agent_runtime]
enabled = {{ and .Values.projectRuntimeNamespaces.enabled .Values.projectRuntimeBridge.enabled .Values.expertAgentRuntime.enabled }}
image = {{ include "tali.image" (dict "root" . "image" .Values.images.expertAgentRuntime) | toJson }}
imagePullPolicy = {{ .Values.images.expertAgentRuntime.pullPolicy | toJson }}
revision = {{ default .Chart.AppVersion .Values.global.rolloutRevision | toJson }}
imagePullSecrets = {{ include "tali.tomlValue" .Values.global.imagePullSecrets }}
resources = {{ include "tali.tomlValue" .Values.expertAgentRuntime.resources }}
{{- end }}

{{- define "tali.controlConfigChecksum" -}}
{{- if .Values.secrets.existingSecrets.control -}}
{{- printf "existing:%s" .Values.secrets.existingSecrets.control | sha256sum -}}
{{- else -}}
{{- include "tali.controlConfig" . | sha256sum -}}
{{- end -}}
{{- end }}

{{- define "tali.runnerSecretChecksum" -}}
{{- if .Values.secrets.existingSecrets.runner -}}
{{- printf "existing:%s" .Values.secrets.existingSecrets.runner | sha256sum -}}
{{- else -}}
{{- include "tali.runnerConfig" . | sha256sum -}}
{{- end -}}
{{- end }}

{{/* Exact resource APIs required to install the pinned official OpenShell chart. */}}
{{- define "tali.projectOpenShellControllerRules" -}}
- apiGroups: [""]
  resources: ["configmaps", "persistentvolumeclaims", "secrets", "serviceaccounts", "services"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: [""]
  resources: ["events", "pods"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["nodes"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["authentication.k8s.io"]
  resources: ["tokenreviews"]
  verbs: ["create"]
- apiGroups: ["agents.x-k8s.io"]
  resources: ["sandboxes", "sandboxes/status"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["apps"]
  resources: ["deployments", "replicasets", "statefulsets"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["networking.k8s.io"]
  resources: ["networkpolicies"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["batch"]
  resources: ["jobs"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["rbac.authorization.k8s.io"]
  resources: ["roles", "rolebindings", "clusterroles", "clusterrolebindings"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
{{- end -}}

{{- define "tali.postgresqlSecretChecksum" -}}
{{- if .Values.secrets.existingSecrets.postgresql -}}
{{- printf "existing:%s" .Values.secrets.existingSecrets.postgresql | sha256sum -}}
{{- else -}}
{{- printf "%s:%s" .Values.secrets.existingSecrets.postgresql .Values.secrets.postgresPassword | sha256sum -}}
{{- end -}}
{{- end }}

{{- define "tali.litellmSecretChecksum" -}}
{{- if .Values.secrets.existingSecrets.litellm -}}
{{- printf "existing:%s" .Values.secrets.existingSecrets.litellm | sha256sum -}}
{{- else -}}
{{- printf "%s:%s:%s:%s:%s:%s" .Values.secrets.existingSecrets.litellm .Values.secrets.litellmMasterKey (include "tali.databaseUrl" .) .Values.secrets.litellmUiUsername .Values.secrets.litellmUiPassword .Values.secrets.litellmSaltKey | sha256sum -}}
{{- end -}}
{{- end }}

{{- define "tali.keycloakSecretChecksum" -}}
{{- printf "%s:%s:%s:%s" .Values.secrets.existingSecrets.keycloak .Values.secrets.keycloakAdminPassword .Values.secrets.keycloakClientSecret .Values.secrets.keycloakTestUserPassword | sha256sum -}}
{{- end }}

{{- define "tali.doclingConfig" -}}
artifacts_path: /var/lib/docling/models/artifacts
eng_kind: local
eng_loc_num_workers: 1
max_file_size: {{ .Values.docling.maxFileSize | int64 }}
max_num_pages: {{ .Values.docling.maxNumPages }}
max_sync_wait: {{ .Values.docling.maxSyncWaitSeconds }}
{{- end }}

{{- define "tali.runnerConfig" -}}
{{- $server := dict "host" "0.0.0.0" "port" 9090 "token" (required "secrets.runnerToken is required" .Values.secrets.runnerToken) "mode" "openshell-kubernetes" "shutdownTimeoutMs" 540000 -}}
{{- $sandbox := dict "cpu" (.Values.runner.sandbox.cpu | toString) "memory" .Values.runner.sandbox.memory "images" (dict "openclaw" (include "tali.image" (dict "root" . "image" .Values.images.openclawSandbox)) "hermes" (include "tali.image" (dict "root" . "image" .Values.images.hermesSandbox)) "deepagents" (include "tali.image" (dict "root" . "image" .Values.images.deepagentsSandbox))) -}}
{{- with .Values.runner.sandbox.cpuRequest -}}{{- $_ := set $sandbox "cpuRequest" (. | toString) -}}{{- end -}}
{{- $proxy := dict "enabled" (and .Values.runner.projectTargetRouting.enabled .Values.runner.projectTargetRouting.serviceProxy.enabled) "port" .Values.runner.projectTargetRouting.serviceProxy.port "host" "0.0.0.0" -}}
{{- $runtime := dict "startTimeoutMs" .Values.runner.startTimeoutMs "projectTargetRouting" .Values.runner.projectTargetRouting.enabled "gatewayEndpointTemplate" .Values.runner.projectTargetRouting.gatewayEndpointTemplate "serviceBaseUrl" .Values.runner.serviceBaseUrl "serviceProxy" $proxy "nemoclawVersion" .Values.projectOpenShell.nemoclawVersion "kubernetesServiceCidrs" (splitList "," .Values.runner.kubernetesServiceCidrs) "sandbox" $sandbox -}}
{{- dict "schemaVersion" 1 "server" $server "openshell" $runtime | toPrettyJson -}}
{{- end }}
