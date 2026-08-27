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
{{- default (include "tali.componentName" (dict "root" . "component" "secrets")) .Values.secrets.existingSecret -}}
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
{{- printf "postgresql://litellm:%s@%s:5432/litellm" .Values.secrets.postgresPassword (include "tali.componentName" (dict "root" . "component" "postgresql")) -}}
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
{{- printf "postgresql://%s:%s@%s:5432/%s" (include "tali.hindsightDatabaseUser" .) (urlquery .Values.secrets.hindsightDatabasePassword) (include "tali.componentName" (dict "root" . "component" "postgresql")) (include "tali.hindsightDatabaseName" .) -}}
{{- end }}

{{- define "tali.hindsightUrl" -}}
{{- printf "http://%s.%s.svc.cluster.local:%v" (include "tali.hindsightServiceName" .) .Release.Namespace .Values.hindsight.service.port -}}
{{- end }}

{{- define "tali.hindsightSecretChecksum" -}}
{{- if .Values.secrets.existingSecret -}}
{{- printf "existing:%s" .Values.secrets.existingSecret | sha256sum -}}
{{- else -}}
{{- printf "%s:%s:%s:%s" .Values.secrets.hindsightDatabasePassword .Values.secrets.hindsightApiKey .Values.secrets.litellmMasterKey (include "tali.hindsightDatabaseUrl" .) | sha256sum -}}
{{- end -}}
{{- end }}

{{- define "tali.hindsightCommonEnv" -}}
- name: HOME
  value: /tmp
- name: PYTHONDONTWRITEBYTECODE
  value: "1"
- name: HINDSIGHT_API_DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "tali.secretName" . }}
      key: hindsight-database-url
- name: HINDSIGHT_API_MIGRATION_DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "tali.secretName" . }}
      key: hindsight-database-url
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
  valueFrom:
    secretKeyRef:
      name: {{ include "tali.secretName" . }}
      key: hindsight-api-key
- name: HINDSIGHT_API_MCP_ENABLED
  value: "false"
- name: HINDSIGHT_API_LLM_TRACE_ENABLED
  value: "false"
- name: HINDSIGHT_API_LLM_DEBUG_DUMP_4XX
  value: "false"
- name: HINDSIGHT_API_LOG_FORMAT
  value: json
- name: HINDSIGHT_API_LOG_JSON_FIELDS
  value: severity,message,timestamp,logger
- name: HINDSIGHT_API_LLM_PROVIDER
  value: openai
- name: HINDSIGHT_API_LLM_BASE_URL
  value: {{ printf "http://%s:4000/v1" (include "tali.componentName" (dict "root" . "component" "litellm")) | quote }}
- name: HINDSIGHT_API_LLM_MODEL
  value: {{ .Values.hindsight.models.llm | quote }}
- name: HINDSIGHT_API_LLM_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "tali.secretName" . }}
      key: litellm-master-key
- name: HINDSIGHT_API_EMBEDDINGS_PROVIDER
  value: litellm
- name: HINDSIGHT_API_EMBEDDINGS_LITELLM_API_BASE
  value: {{ printf "http://%s:4000" (include "tali.componentName" (dict "root" . "component" "litellm")) | quote }}
- name: HINDSIGHT_API_EMBEDDINGS_LITELLM_MODEL
  value: {{ .Values.hindsight.models.embedding | quote }}
- name: HINDSIGHT_API_EMBEDDINGS_LITELLM_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "tali.secretName" . }}
      key: litellm-master-key
- name: HINDSIGHT_API_RERANKER_PROVIDER
  value: litellm
- name: HINDSIGHT_API_RERANKER_LITELLM_API_BASE
  value: {{ printf "http://%s:4000" (include "tali.componentName" (dict "root" . "component" "litellm")) | quote }}
- name: HINDSIGHT_API_RERANKER_LITELLM_MODEL
  value: {{ .Values.hindsight.models.reranker | quote }}
- name: HINDSIGHT_API_RERANKER_LITELLM_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "tali.secretName" . }}
      key: litellm-master-key
{{- end }}

{{- define "tali.controlConfig" -}}
{{- if not .Values.control.publicUrl -}}
{{- fail "control.publicUrl is required for Better Auth" -}}
{{- end -}}
schema_version = 1

[server]
{{- with .Values.control.publicUrl }}
public_url = {{ . | quote }}
{{- end }}

[database]
url = {{ include "tali.databaseUrl" . | quote }}

[auth]
secret = {{ required "secrets.authSecret is required" .Values.secrets.authSecret | quote }}

[auth.local]
initial_platform_administrator_username = {{ required "auth.local.username is required for the initial Platform Administrator bootstrap" .Values.auth.local.username | quote }}
initial_platform_administrator_email = {{ required "auth.local.email is required for the initial Platform Administrator bootstrap" .Values.auth.local.email | quote }}
initial_platform_administrator_password = {{ required "secrets.initialPlatformAdministratorPassword is required for the initial Platform Administrator bootstrap" (default .Values.secrets.initialSuperAdminPassword .Values.secrets.initialPlatformAdministratorPassword) | quote }}
{{- end }}

{{- define "tali.controlConfigChecksum" -}}
{{- if .Values.secrets.existingSecret -}}
{{- printf "existing:%s" .Values.secrets.existingSecret | sha256sum -}}
{{- else -}}
{{- include "tali.controlConfig" . | sha256sum -}}
{{- end -}}
{{- end }}

{{- define "tali.runnerSecretChecksum" -}}
{{- if .Values.secrets.existingSecret -}}
{{- printf "existing:%s" .Values.secrets.existingSecret | sha256sum -}}
{{- else -}}
{{- printf "%s:%s" .Values.secrets.existingSecret .Values.secrets.runnerToken | sha256sum -}}
{{- end -}}
{{- end }}

{{/* Environment shared by synchronous Control and background Worker runtime reconciliation. */}}
{{- define "tali.projectOpenShellReconcilerEnv" -}}
- name: PROJECT_OPENSHELL_GATEWAYS_ENABLED
  value: {{ .Values.projectOpenShell.enabled | quote }}
- name: PROJECT_OPENSHELL_TARGET_ROUTING_ENABLED
  value: {{ .Values.runner.projectTargetRouting.enabled | quote }}
- name: PROJECT_OPENSHELL_HELM_CHART
  value: {{ .Values.projectOpenShell.helmChart | quote }}
- name: PROJECT_OPENSHELL_RELEASE_NAME
  value: {{ .Values.projectOpenShell.releaseName | quote }}
- name: PROJECT_OPENSHELL_SERVICE_NAME_PREFIX
  value: {{ .Values.projectOpenShell.serviceNamePrefix | quote }}
- name: PROJECT_OPENSHELL_GATEWAY_IMAGE
  value: {{ printf "%s:%s" .Values.openshell.image.repository .Values.openshell.image.tag | quote }}
- name: PROJECT_OPENSHELL_GATEWAY_RESOURCES_JSON
  value: {{ .Values.openshell.resources | toJson | quote }}
- name: PROJECT_OPENSHELL_IMAGE_PULL_SECRETS_JSON
  value: {{ .Values.openshell.imagePullSecrets | toJson | quote }}
- name: PROJECT_OPENSHELL_SUPERVISOR_IMAGE
  value: {{ printf "%s:%s" .Values.openshell.supervisor.image.repository .Values.openshell.supervisor.image.tag | quote }}
- name: PROJECT_OPENSHELL_DEFAULT_SANDBOX_IMAGE
  value: {{ .Values.openshell.server.sandboxImage | quote }}
- name: PROJECT_OPENSHELL_IMAGE_PULL_POLICY
  value: {{ .Values.openshell.image.pullPolicy | quote }}
- name: PROJECT_OPENSHELL_SANDBOX_IMAGE_PULL_POLICY
  value: {{ .Values.openshell.server.sandboxImagePullPolicy | quote }}
- name: PROJECT_OPENSHELL_SANDBOX_IMAGE_PULL_SECRETS_JSON
  value: {{ .Values.openshell.server.sandboxImagePullSecrets | toJson | quote }}
- name: PROJECT_OPENSHELL_WORKSPACE_STORAGE_SIZE
  value: {{ .Values.projectOpenShell.workspace.storageSize | quote }}
{{- with .Values.projectOpenShell.workspace.storageClass }}
- name: PROJECT_OPENSHELL_WORKSPACE_STORAGE_CLASS
  value: {{ . | quote }}
{{- end }}
- name: PROJECT_RUNTIME_BRIDGES_ENABLED
  value: {{ and .Values.projectRuntimeNamespaces.enabled .Values.projectRuntimeBridge.enabled | quote }}
- name: PROJECT_RUNTIME_BRIDGE_IMAGE
  value: {{ include "tali.image" (dict "root" . "image" .Values.images.control) | quote }}
- name: PROJECT_RUNTIME_BRIDGE_IMAGE_PULL_POLICY
  value: {{ .Values.images.control.pullPolicy | quote }}
- name: PROJECT_RUNTIME_BRIDGE_REVISION
  value: {{ default .Chart.AppVersion .Values.global.rolloutRevision | quote }}
- name: PROJECT_RUNTIME_BRIDGE_IMAGE_PULL_SECRETS_JSON
  value: {{ .Values.global.imagePullSecrets | toJson | quote }}
- name: PROJECT_RUNTIME_BRIDGE_RESOURCES_JSON
  value: {{ .Values.projectRuntimeBridge.resources | toJson | quote }}
- name: PROJECT_RUNTIME_BRIDGE_STORAGE_SIZE
  value: {{ .Values.projectRuntimeBridge.storageSize | quote }}
{{- with .Values.projectRuntimeBridge.storageClass }}
- name: PROJECT_RUNTIME_BRIDGE_STORAGE_CLASS
  value: {{ . | quote }}
{{- end }}
{{- end -}}

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
{{- if .Values.secrets.existingSecret -}}
{{- printf "existing:%s" .Values.secrets.existingSecret | sha256sum -}}
{{- else -}}
{{- printf "%s:%s" .Values.secrets.existingSecret .Values.secrets.postgresPassword | sha256sum -}}
{{- end -}}
{{- end }}

{{- define "tali.litellmSecretChecksum" -}}
{{- if .Values.secrets.existingSecret -}}
{{- printf "existing:%s" .Values.secrets.existingSecret | sha256sum -}}
{{- else -}}
{{- printf "%s:%s:%s:%s:%s:%s" .Values.secrets.existingSecret .Values.secrets.litellmMasterKey (include "tali.databaseUrl" .) .Values.secrets.litellmUiUsername .Values.secrets.litellmUiPassword .Values.secrets.litellmSaltKey | sha256sum -}}
{{- end -}}
{{- end }}

{{- define "tali.keycloakSecretChecksum" -}}
{{- printf "%s:%s:%s:%s" .Values.secrets.existingSecret .Values.secrets.keycloakAdminPassword .Values.secrets.keycloakClientSecret .Values.secrets.keycloakTestUserPassword | sha256sum -}}
{{- end }}
