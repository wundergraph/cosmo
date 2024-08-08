# studio

![Version: 0.0.1](https://img.shields.io/badge/Version-0.0.1-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.83.5](https://img.shields.io/badge/AppVersion-0.83.5-informational?style=flat-square)

WunderGraph Cosmo Studio.

**Homepage:** <https://wundergraph.com>

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` |  |
| autoscaling.enabled | bool | `false` |  |
| autoscaling.maxReplicas | int | `100` |  |
| autoscaling.minReplicas | int | `1` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` |  |
| configuration.slackClientId | string | `""` | The client ID of the slack app to use for slack app integration |
| configuration.stripePublishableKey | string | `""` | The publishable key of the stripe account to use for stripe integration |
| deploymentStrategy | object | `{}` |  |
| extraEnvVars | list | `[]` | Allows to set additional environment variables on the container. Useful for global application non-specific settings. |
| fullnameOverride | string | `""` | String to fully override common.names.fullname template |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| image.registry | string | `"ghcr.io"` |  |
| image.repository | string | `"wundergraph/cosmo/studio"` |  |
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
| probes.liveness | object | `{"httpGet":{"path":"/","port":"http"}}` | Configure liveness probe |
| probes.readiness | object | `{"httpGet":{"path":"/","port":"http"}}` | Configure readiness probe |
| replicaCount | int | `1` |  |
| resources | object | `{}` |  |
| securityContext | object | `{}` |  |
| service.port | int | `3000` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` | Annotations to add to the service account |
| serviceAccount.create | bool | `true` | Specifies whether a service account should be created |
| serviceAccount.name | string | `""` | The name of the service account to use. If not set and create is true, a name is generated using the fullname template |
| serviceAnnotations | object | `{}` |  |
| terminationGracePeriodSeconds | int | `5` | Sets the [termination grace period](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/#hook-handler-execution) for Deployment pods |
| tolerations | list | `[]` |  |

