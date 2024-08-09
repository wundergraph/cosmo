# graphqlmetrics

![Version: 0.1.0](https://img.shields.io/badge/Version-0.1.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.21.1](https://img.shields.io/badge/AppVersion-0.21.1-informational?style=flat-square)

WunderGraph Cosmo GraphQL Metrics Collector

**Homepage:** <https://wundergraph.com>

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` |  |
| autoscaling.enabled | bool | `false` |  |
| autoscaling.maxReplicas | int | `100` |  |
| autoscaling.minReplicas | int | `1` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` |  |
| configuration.clickhouseDsn | string | `"clickhouse://default:changeme@cosmo-clickhouse:9000/cosmo?dial_timeout=15s&compress=lz4"` |  |
| configuration.listenAddr | string | `"0.0.0.0:4005"` |  |
| configuration.logLevel | string | `"info"` |  |
| configuration.prometheus | object | `{"enabled":false,"gcpMonitoring":{"enabled":false,"interval":"60s","timeout":"50s"},"host":"127.0.0.1","path":"/metrics","port":8088}` | Use this section to configure prometheus metrics. |
| configuration.prometheus.enabled | bool | `false` | Enables prometheus metrics support. Default is false. |
| configuration.prometheus.gcpMonitoring.enabled | bool | `false` | Enables gcp support . Default is false. |
| configuration.prometheus.gcpMonitoring.interval | string | `"60s"` | Scrape interval. Default is "60s". |
| configuration.prometheus.gcpMonitoring.timeout | string | `"50s"` | Scrape timeout. Default is "50s". |
| configuration.prometheus.host | string | `"127.0.0.1"` | The host to bind to defautls to 127.0.0.1 to avoid opening the metrics endpoint by default. |
| configuration.prometheus.path | string | `"/metrics"` | The HTTP path where metrics are exposed. Default is "/metrics". |
| configuration.prometheus.port | int | `8088` | The port where metrics are exposed. Default is port 8088. |
| deploymentStrategy | object | `{}` |  |
| existingSecret | string | `""` | Existing secret in the same namespace containing the graphqlmetrics Secrets - clickhouseDsn,jwtSecret. The secret keys have to match with current secret. |
| extraEnvVars | list | `[]` | Allows to set additional environment / runtime variables on the container. Useful for global application non-specific settings. |
| fullnameOverride | string | `""` | String to fully override common.names.fullname template |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| image.registry | string | `"ghcr.io"` |  |
| image.repository | string | `"wundergraph/cosmo/graphqlmetrics"` |  |
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
| probes.liveness | object | `{"initialDelaySeconds":10}` | Configure liveness probe |
| probes.readiness | object | `{"initialDelaySeconds":10}` | Configure readiness probe |
| replicaCount | int | `1` |  |
| resources | object | `{}` |  |
| securityContext | object | `{}` |  |
| service.port | int | `4005` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` | Annotations to add to the service account |
| serviceAccount.create | bool | `true` | Specifies whether a service account should be created |
| serviceAccount.name | string | `""` | The name of the service account to use. If not set and create is true, a name is generated using the fullname template |
| serviceAnnotations | object | `{}` |  |
| terminationGracePeriodSeconds | int | `10` | Sets the [termination grace period](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/#hook-handler-execution) for Deployment pods |
| tolerations | list | `[]` |  |

