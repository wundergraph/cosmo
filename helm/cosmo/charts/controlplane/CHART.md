# controlplane

![Version: 0.0.1](https://img.shields.io/badge/Version-0.0.1-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.0.1](https://img.shields.io/badge/AppVersion-0.0.1-informational?style=flat-square)

WunderGraph Cosmo Controlplane

**Homepage:** <https://wundergraph.com>

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` |  |
| autoscaling.enabled | bool | `false` |  |
| autoscaling.maxReplicas | int | `100` |  |
| autoscaling.minReplicas | int | `1` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` |  |
| configuration.allowedOrigins[0] | string | `"*"` |  |
| configuration.authRedirectUri | string | `"http://controlplane.wundergraph.local/v1/auth/callback"` |  |
| configuration.clickhouseDsn | string | `"http://default:changeme@cosmo-clickhouse:8123?database=cosmo"` |  |
| configuration.clickhouseMigrationDsn | string | `"clickhouse://default:changeme@cosmo-clickhouse:9000?database=cosmo"` |  |
| configuration.databaseUrl | string | `"postgres://postgres:changeme@cosmo-postgresql:5432/controlplane"` |  |
| configuration.debugSQL | bool | `false` |  |
| configuration.defaultPlan | string | `""` |  |
| configuration.githubAppClientId | string | `""` |  |
| configuration.githubAppClientSecret | string | `""` |  |
| configuration.githubAppId | string | `""` |  |
| configuration.githubAppPrivateKey | string | `""` |  |
| configuration.githubAppWebhookSecret | string | `""` |  |
| configuration.logLevel | string | `"info"` |  |
| configuration.s3StorageUrl | string | `"http://minio:changeme@minio.wundergraph.local:9000/cosmo"` |  |
| configuration.slackAppClientId | string | `""` |  |
| configuration.slackAppClientSecret | string | `""` |  |
| configuration.smtpPassword | string | `""` |  |
| configuration.smtpUsername | string | `""` |  |
| configuration.stripeSecretKey | string | `""` |  |
| configuration.stripeWebhookSecret | string | `""` |  |
| configuration.webhookSecret | string | `""` |  |
| configuration.webhookUrl | string | `""` |  |
| deploymentStrategy | object | `{}` |  |
| fullnameOverride | string | `""` | String to fully override common.names.fullname template |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| image.registry | string | `"ghcr.io"` |  |
| image.repository | string | `"wundergraph/cosmo/controlplane"` |  |
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
| probes.liveness | object | `{"failureThreshold":5,"httpGet":{"path":"/health","port":"http"},"initialDelaySeconds":10,"periodSeconds":10,"timeoutSeconds":5}` | Configure liveness probe |
| probes.readiness | object | `{"failureThreshold":5,"httpGet":{"path":"/health","port":"http"},"initialDelaySeconds":5,"periodSeconds":5,"timeoutSeconds":3}` | Configure readiness probe |
| replicaCount | int | `1` |  |
| resources | object | `{}` |  |
| securityContext | object | `{}` |  |
| service.port | int | `3001` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` | Annotations to add to the service account |
| serviceAccount.create | bool | `true` | Specifies whether a service account should be created |
| serviceAccount.name | string | `""` | The name of the service account to use. If not set and create is true, a name is generated using the fullname template |
| serviceAnnotations | object | `{}` |  |
| terminationGracePeriodSeconds | int | `60` | Sets the [termination grace period](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/#hook-handler-execution) for Deployment pods |
| tolerations | list | `[]` |  |
| volumeMounts | list | `[]` |  |
| volumes | list | `[]` |  |
