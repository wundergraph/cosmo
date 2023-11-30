{{/*
Define the chart full names
*/}}
{{- define "cosmo.fullname" -}}
{{- printf "%s-%s" .Release.Name "cosmo" | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Define subcharts full names
*/}}
{{- define "cdn.fullname" -}}
{{- printf "%s-%s" .Release.Name "cdn" | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "postgresql.fullname" -}}
{{- printf "%s-%s" .Release.Name "postgresql" | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "clickhouse.fullname" -}}
{{- printf "%s-%s" .Release.Name "clickhouse" | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "otelcollector.fullname" -}}
{{- printf "%s-%s" .Release.Name "otelcollector" | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "graphqlmetrics.fullname" -}}
{{- printf "%s-%s" .Release.Name "graphqlmetrics" | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "router.fullname" -}}
{{- printf "%s-%s" .Release.Name "router" | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "keycloak.fullname" -}}
{{- printf "%s-%s" .Release.Name "keycloak" | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "controlplane.fullname" -}}
{{- printf "%s-%s" .Release.Name "controlplane" | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "studio.fullname" -}}
{{- printf "%s-%s" .Release.Name "studio" | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Expand the name of the chart.
*/}}
{{- define "cosmo.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "cosmo.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "cosmo.labels" -}}
helm.sh/chart: {{ include "cosmo.chart" . }}
{{ include "cosmo.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "cosmo.selectorLabels" -}}
app.kubernetes.io/name: {{ include "cosmo.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
