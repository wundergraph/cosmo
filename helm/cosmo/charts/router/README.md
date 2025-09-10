# router

![Version: 0.15.0](https://img.shields.io/badge/Version-0.15.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.243.0](https://img.shields.io/badge/AppVersion-0.243.0-informational?style=flat-square)

This is the official Helm Chart for the WunderGraph Cosmo Router.

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| additionalLabels | object | `{}` | Add labels to deployment (metadata.labels) |
| additionalPodLabels | object | `{}` | Add labels to deployment pod template (spec.template.metadata.labels) |
| affinity | object | `{}` |  |
| autoscaling.enabled | bool | `false` |  |
| autoscaling.maxReplicas | int | `100` |  |
| autoscaling.minReplicas | int | `1` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` |  |
| commonConfiguration | string | `"version: \"1\"\nlog_level: \"info\""` | You can use this to provide the router configuration via yaml. Values here have precedence over the configurations section. For a full list of available configuration options, see https://cosmo-docs.wundergraph.com/router/configuration This value is processed with the helm `tpl` function allowing referencing of variables and inclusion of templates |
| commonConfigurationPath | string | `""` | Path to a configuration file to embed. If set, this takes precedence over commonConfiguration. The file path is relative to the chart directory and will be processed with the helm `tpl` function. Example: "configs/router-config.yaml" |
| commonLabels | object | `{}` | Add labels to all deployed resources |
| configuration.cdnUrl | string | `""` |  |
| configuration.configPath | string | `""` | The path to the router config file. This does not refer to the execution config. See: https://cosmo-docs.wundergraph.com/router/configuration#config-file |
| configuration.controlplaneUrl | string | `""` | The URL of the Cosmo Controlplane. Should be internal to the cluster. Default to cloud if not set. |
| configuration.devMode | bool | `false` | Set to true to enable the development mode. This allows for Advanced Request Tracing (ART) in the GraphQL Playground |
| configuration.executionConfig | string | `""` | The execution config file to statically configure the router. If set, polling of the config is disabled. If your config exceeds 1MB (Kubernetes limit), you have to mount it as a file and set the path in routerConfigPath instead |
| configuration.graphApiToken | string | `"replace-me"` | The router token is used to authenticate the router against the controlplane (required) |
| configuration.graphqlMetricsCollectorUrl | string | `""` | The URL of the Cosmo GraphQL Metrics Collector. Should be internal to the cluster. Default to cloud if not set. |
| configuration.httpProxy | string | `""` | The URL of the HTTP proxy server. Default is an empty string. |
| configuration.httpsProxy | string | `""` | The URL of the HTTPS proxy server. Default is an empty string. |
| configuration.logLevel | string | `"info"` | The log level of the router. Default to info if not set. |
| configuration.mcp.enabled | bool | `false` | Enables MCP server support. Default is false. |
| configuration.mcp.port | int | `5025` | The port where the MCP server is exposed. Default is port 5025. |
| configuration.noProxy | string | `""` | NO_PROXY is a comma-separated list of hosts or domains for which the proxy should not be used. |
| configuration.otelCollectorUrl | string | `""` | The URL of the Cosmo GraphQL OTEL Collector. Should be internal to the cluster. Default to cloud if not set. |
| configuration.prometheus.enabled | bool | `true` | Enables prometheus metrics support. Default is true. |
| configuration.prometheus.path | string | `"/metrics"` | The HTTP path where metrics are exposed. Default is "/metrics". |
| configuration.prometheus.port | int | `8088` | The port where metrics are exposed. Default is port 8088. |
| configuration.routerConfigPath | string | `""` | The path to the router execution config file. Before, you have to mount the file as a volume and set the path here. A possible to solution could be to use an init container to download the file from a CDN. If set, polling of the config is disabled. |
| deploymentStrategy | object | `{}` |  |
| existingConfigmap | string | `""` | The name of the configmap to use for the router configuration. The key "config.yaml" is required in the configmap. If this is set, the commonConfiguration section is ignored. |
| existingSecret | string | `""` | Existing secret in the same namespace containing the graphApiToken. The secret key has to match with current secret. |
| extraEnvVars | list | `[]` | Allows to set additional environment / runtime variables on the container. Useful for global application non-specific settings. |
| extraEnvVarsCM | string | `""` | Name of existing ConfigMap containing extra env vars |
| extraEnvVarsSecret | string | `""` | Name of existing Secret containing extra env vars |
| extraVolumeMounts | list | `[]` | Optionally specify extra list of additional volumeMounts for Router container's |
| extraVolumes | list | `[]` | Optionally specify extra list of additional volumes for Router pods |
| fullnameOverride | string | `""` | String to fully override common.names.fullname template |
| global.helmTests | bool | `false` |  |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| image.registry | string | `"ghcr.io"` |  |
| image.repository | string | `"wundergraph/cosmo/router"` |  |
| imagePullSecrets | list | `[]` |  |
| ingress.hosts | string | `nil` |  |
| ingress.tls | list | `[]` |  |
| istioGateway | object | `{"annotations":{},"enabled":false,"hosts":[],"selector":{}}` | Requires Istio v1.5 or greater |
| istioGateway.annotations | object | `{}` | Annotations for the Gateway |
| istioGateway.enabled | bool | `false` | enable the istioGateway - often used in conjunction with istioVirtualService to expose services via an istio gateway deployment |
| istioGateway.hosts | list | `[]` | List of hosts that the gateway can serve |
| istioGateway.selector | object | `{}` | Selectors for the Gateway deployment |
| istioVirtualService | object | `{"annotations":{},"enabled":false}` | Requires Istio v1.5 or greater |
| istioVirtualService.annotations | object | `{}` | Annotations for the VirtualService |
| istioVirtualService.enabled | bool | `false` | enable an Istio VirtualService |
| nameOverride | string | `""` | String to partially override common.names.fullname template (will maintain the release name) |
| nodeSelector | object | `{}` |  |
| podAnnotations | object | `{}` |  |
| podDisruptionBudget | object | `{}` | Sets the [pod disruption budget](https://kubernetes.io/docs/tasks/run-application/configure-pdb/) for Deployment pods |
| podSecurityContext | object | `{}` |  |
| priorityClassName | string | `""` | Set to existing PriorityClass name to control pod preemption by the scheduler |
| probes.liveness | object | `{"httpGet":{"path":"/health/live","port":"http"},"initialDelaySeconds":10}` | Configure liveness probe |
| probes.readiness | object | `{"httpGet":{"path":"/health/ready","port":"http"},"initialDelaySeconds":5}` | Configure readiness probe |
| replicaCount | int | `1` |  |
| resources | object | `{}` |  |
| securityContext | object | `{}` |  |
| service.port | int | `3002` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` | Annotations to add to the service account |
| serviceAccount.create | bool | `true` | Specifies whether a service account should be created |
| serviceAccount.name | string | `""` | The name of the service account to use. If not set and create is true, a name is generated using the fullname template |
| serviceAnnotations | object | `{}` |  |
| terminationGracePeriodSeconds | int | `30` | Sets the [termination grace period](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/#hook-handler-execution) for Deployment pods |
| tolerations | list | `[]` |  |

