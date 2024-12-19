{{- range .}}
{{- range .Vulnerabilities}}
\n#### {{ .VulnerabilityID | html }} {{ .Title | html }}\n{{ .Description | html }}\n
{{ end }}
{{- end }}