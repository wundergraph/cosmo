# otelcollector

![Version: 0.1.0](https://img.shields.io/badge/Version-0.1.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.17.0](https://img.shields.io/badge/AppVersion-0.17.0-informational?style=flat-square)

WunderGraph Cosmo Open Telemetry Collector.

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
| configuration.prometheus | object | `{"enabled":false,"gcpMonitoring":{"enabled":false,"interval":"60s","timeout":"50s"},"host":"127.0.0.1","level":"basic","port":8088}` | Use this section to configure prometheus metrics. |
| configuration.prometheus.enabled | bool | `false` | Enables prometheus metrics support. Default is false. |
| configuration.prometheus.gcpMonitoring.enabled | bool | `false` | Enables gcp support . Default is false. |
| configuration.prometheus.gcpMonitoring.interval | string | `"60s"` | Scrape interval. Default is "60s". |
| configuration.prometheus.gcpMonitoring.timeout | string | `"50s"` | Scrape timeout. Default is "50s". |
| configuration.prometheus.host | string | `"127.0.0.1"` | The host to bind to defautls to 127.0.0.1 to avoid opening the metrics endpoint by default. |
| configuration.prometheus.level | string | `"basic"` | The level of telemetry to be collected. Default is "basic". One of "none", "basic", "normal", "detailed". |
| configuration.prometheus.port | int | `8088` | The port where metrics are exposed. Default is port 8088. |
| deploymentStrategy | object | `{}` |  |
| existingConfigmap | string | `nil` | The name of the configmap to use for the otelcollector configuration. The key must be "otel-config.yaml". |
| existingSecret | string | `""` | Existing secret in the same namespace containing the otelcollector Secrets - clickhouseDsn,authJwtSecret. The secret keys have to match with current secret. |
| extraEnvVars | string | `nil` | Allows to set additional environment / runtime variables on the container. Useful for global application non-specific settings. |
| fullnameOverride | string | `""` |  |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| image.registry | string | `"ghcr.io"` |  |
| image.repository | string | `"wundergraph/cosmo/otelcollector"` |  |
| image.version | string | `"latest"` |  |
| imagePullSecrets | list | `[]` |  |
| ingress.hosts | string | `nil` |  |
| ingress.tls | list | `[]` |  |
| nameOverride | string | `""` |  |
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
| service.port | int | `4318` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` |  |
| serviceAccount.create | bool | `true` |  |
| serviceAccount.name | string | `""` |  |
| serviceAnnotations | object | `{}` |  |
| terminationGracePeriodSeconds | int | `10` | Sets the [termination grace period](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/#hook-handler-execution) for Deployment pods |
| tolerations | list | `[]` |  |

