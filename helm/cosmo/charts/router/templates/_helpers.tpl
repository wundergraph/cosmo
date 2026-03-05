{{/*
Expand the name of the chart.
*/}}
{{- define "router.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create the image path for the passed in image field
*/}}
{{- define "router.image" -}}
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
{{- define "router.fullname" -}}
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
{{- define "router.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Additional Labels that are just rendered in metadata.labels
*/}}
{{- define "router.additionalLabels" -}}
{{- range $key, $value := .Values.additionalLabels }}
{{ $key }}: {{ quote $value }}
{{- end }}
{{- end }}

{{/*
Additional Pod Labels that are just rendered in metadata.labels
*/}}
{{- define "router.additionalPodLabels" -}}
{{- range $key, $value := .Values.additionalPodLabels }}
{{ $key }}: {{ quote $value }}
{{- end }}
{{- end }}

{{/*
Common labels
Includes standard Kubernetes recommended labels, selector labels,
and user-defined commonLabels. Note: commonLabels are rendered here
(not in selectorLabels) to avoid adding mutable labels to immutable
selector matchLabels.
*/}}
{{- define "router.labels" -}}
{{ $version := .Values.image.version | default .Chart.AppVersion | replace ":" "_" | trunc 63 -}}
helm.sh/chart: {{ include "router.chart" . }}
{{ include "router.selectorLabels" . }}
app.kubernetes.io/version: {{ $version | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- range $key, $value := .Values.commonLabels }}
{{ $key }}: {{ quote $value }}
{{- end }}
{{- end }}

{{/*
Selector labels
Used in spec.selector.matchLabels which are immutable after creation.
Only include stable, deterministic labels here -- do not add commonLabels
or other user-configurable values.
*/}}
{{- define "router.selectorLabels" -}}
app.kubernetes.io/name: {{ include "router.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "router.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "router.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Get the name of the secret to use
*/}}
{{- define "router.secretName" -}}
{{- if .Values.existingSecret -}}
    {{- .Values.existingSecret -}}
{{- else }}
    {{- printf "%s-secret" (include "router.fullname" .) -}}
{{- end -}}
{{- end -}}
