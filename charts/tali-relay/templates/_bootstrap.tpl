{{- define "tali.credentialSecretName" -}}
{{- default (include "tali.componentName" (dict "root" . "component" "credentials")) .Values.credentialBootstrap.existingSecret -}}
{{- end }}

{{- define "tali.exampleMcpSecretName" -}}
{{- printf "%s-auth" (include "tali.componentName" (dict "root" . "component" "example-mcp")) -}}
{{- end }}

{{- define "tali.bootstrapSpec" -}}
{{- if not (kindIs "bool" .Values.credentialBootstrap.developmentMode) -}}
{{- fail "credentialBootstrap.developmentMode must be a boolean" -}}
{{- end -}}
{{- if and .Values.credentialBootstrap.developmentMode .Values.credentialBootstrap.existingSecret -}}
{{- fail "Local development credentials cannot use an external credential store" -}}
{{- end -}}
{{- $outputs := list -}}
{{- $definitions := list
  (dict "component" "control" "enabled" true "fields" (dict "control.toml" (include "tali.controlConfig" .)) "formats" (dict "control.toml" "toml"))
  (dict "component" "runner" "enabled" true "fields" (dict "runner.json" (include "tali.runnerConfig" .)) "formats" (dict "runner.json" "json"))
  (dict "component" "postgresql" "enabled" true "fields" (dict "postgres-password" (include "tali.credential" "postgresPassword") "admin-url" (include "tali.credential" "adminUrl")))
  (dict "component" "litellm" "enabled" true "fields" (dict "litellm-config.yaml" "{}" "database-url" (include "tali.databaseUrl" .) "litellm-master-key" (include "tali.credential" "litellmMasterKey") "litellm-ui-username" .Values.litellmAdministration.username "litellm-ui-password" (include "tali.credential" "litellmUiPassword") "litellm-salt-key" (include "tali.credential" "litellmSaltKey")))
  (dict "component" "hindsight" "enabled" .Values.hindsight.enabled "fields" (dict "hindsight-config.json" (include "tali.hindsightConfig" .)) "formats" (dict "hindsight-config.json" "json"))
  (dict "component" "metrics" "enabled" true "fields" (dict "metrics-token" (include "tali.credential" "metricsToken")))
  (dict "component" "keycloak" "enabled" .Values.keycloak.enabled "fields" (dict "keycloak-admin-password" (include "tali.credential" "keycloakAdminPassword") "keycloak-client-secret" (include "tali.credential" "keycloakClientSecret") "keycloak-test-user-password" (include "tali.credential" "keycloakTestUserPassword")))
  (dict "component" "exampleMcp" "enabled" .Values.exampleMcp.enabled "fields" (dict "username" .Values.exampleMcp.auth.username "password" (include "tali.credential" "exampleMcpPassword") "auth-value" (printf "%s:%s" .Values.exampleMcp.auth.username (include "tali.credential" "exampleMcpPassword"))))
-}}
{{- range $item := $definitions -}}
{{- if $item.enabled -}}
{{- $name := include "tali.secretName" (dict "root" $ "component" $item.component) -}}
{{- if eq $item.component "exampleMcp" -}}{{- $name = include "tali.exampleMcpSecretName" $ -}}{{- end -}}
{{- $outputs = append $outputs (dict "name" $name "fields" $item.fields "formats" (default dict $item.formats)) -}}
{{- end -}}
{{- end -}}
{{- dict "namespace" .Release.Namespace "release" .Release.Name "developmentMode" .Values.credentialBootstrap.developmentMode "credentialSecret" (include "tali.credentialSecretName" .) "externalCredentials" (not (empty .Values.credentialBootstrap.existingSecret)) "databaseHost" (printf "%s.%s.svc.cluster.local" (include "tali.componentName" (dict "root" . "component" "postgresql")) .Release.Namespace) "hindsightDatabase" (include "tali.hindsightDatabaseName" .) "hindsightUser" (include "tali.hindsightDatabaseUser" .) "outputs" $outputs | toJson -}}
{{- end }}
