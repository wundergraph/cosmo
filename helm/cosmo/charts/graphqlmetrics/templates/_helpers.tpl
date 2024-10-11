{{/*
Expand the name of the chart.
*/}}
{{- define "graphqlmetrics.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create the image path for the passed in image field
*/}}
{{- define "graphqlmetrics.image" -}}
{{- if and (.Values.image.version) (eq (substr 0 7 .Values.image.version) "sha256:") -}}
{{- printf "%s/%s@%s" .Values.image.registry .Values.image.repository .Values.image.version -}}
{{- else if .Values.image.version -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.repository .Values.image.version -}}
{{- else -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.repository .Chart.AppVersion -}}
{{- end -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "graphqlmetrics.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "graphqlmetrics.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "graphqlmetrics.labels" -}}
{{ $version := .Values.image.version | default .Chart.AppVersion -}}
helm.sh/chart: {{ include "graphqlmetrics.chart" . }}
{{ include "graphqlmetrics.selectorLabels" . }}
app.kubernetes.io/version: {{ $version | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "graphqlmetrics.selectorLabels" -}}
app.kubernetes.io/name: {{ include "graphqlmetrics.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- range $key, $value := .Values.commonLabels }}
{{ $key }}: {{ quote $value }}
{{- end }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "graphqlmetrics.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "graphqlmetrics.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Get the name of the secret to use
*/}}
{{- define "graphqlmetrics.secretName" -}}
{{- if .Values.existingSecret -}}
    {{- .Values.existingSecret -}}
{{- else }}
    {{- printf "%s-secret" (include "graphqlmetrics.fullname" .) -}}
{{- end -}}
{{- end -}}
