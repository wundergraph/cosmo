# router

![Version: 0.1.0](https://img.shields.io/badge/Version-0.1.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.0.1](https://img.shields.io/badge/AppVersion-0.0.1-informational?style=flat-square)

WunderGraph Cosmo router.

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` |  |
| autoscaling.enabled | bool | `false` |  |
| autoscaling.maxReplicas | int | `100` |  |
| autoscaling.minReplicas | int | `1` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` |  |
| configuration.controlplaneUrl | string | `""` | The URL of the Cosmo Controlplane. Should be internal to the cluster. Default to cloud if not set. |
| configuration.devMode | bool | `false` | Set to true to enable the development mode. This allows for Advanced Request Tracing (ART) in the GraphQL Playground |
| configuration.executionConfig | string | `""` | The execution config file to statically configure the router (If no pulling of the config is desired) |
| configuration.graphApiToken | string | `"replace-me"` | The router token is used to authenticate the router against the controlplane (required) |
| configuration.graphqlMetricsCollectorUrl | string | `""` | The URL of the Cosmo GraphQL Metrics Collector. Should be internal to the cluster. Default to cloud if not set. |
| configuration.logLevel | string | `"info"` | The log level of the router. Default to info if not set. |
| configuration.otelCollectorUrl | string | `""` | The URL of the Cosmo GraphQL OTEL Collector. Should be internal to the cluster. Default to cloud if not set. |
| deploymentStrategy | object | `{}` |  |
| existingConfigmap | string | `""` | Optionally name of existing ConfigMap with Router configuration. The key config.yaml is required. |
| extraEnvVars | list | `[]` | Allows to set additional environment variables on the container |
| extraEnvVarsCM | string | `""` | Name of existing ConfigMap containing extra env vars |
| extraEnvVarsSecret | string | `""` | Name of existing Secret containing extra env vars |
| extraVolumeMounts | list | `[]` | Optionally specify extra list of additional volumeMounts for Router container's |
| extraVolumes | list | `[]` | Optionally specify extra list of additional volumes for Router pods |
| fullnameOverride | string | `""` | String to fully override common.names.fullname template |
| global.helmTests | bool | `false` |  |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| image.registry | string | `"ghcr.io"` |  |
| image.repository | string | `"wundergraph/cosmo/router"` |  |
| image.version | string | `"latest"` | Overrides the image tag whose default is the chart appVersion. |
| imagePullSecrets | list | `[]` |  |
| ingress.hosts | string | `nil` |  |
| ingress.tls | list | `[]` |  |
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

