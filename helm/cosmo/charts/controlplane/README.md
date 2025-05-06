# controlplane

![Version: 0.1.0](https://img.shields.io/badge/Version-0.1.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.133.1](https://img.shields.io/badge/AppVersion-0.133.1-informational?style=flat-square)

WunderGraph Cosmo Controlplane

**Homepage:** <https://wundergraph.com>

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| additionalJobLabels | object | `{}` | Pass additional labels to all jobs |
| affinity | object | `{}` |  |
| autoscaling.enabled | bool | `false` |  |
| autoscaling.maxReplicas | int | `100` |  |
| autoscaling.minReplicas | int | `1` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` |  |
| commonLabels | object | `{}` | Add labels to all deployed resources |
| configuration.allowedOrigins[0] | string | `"*"` |  |
| configuration.authRedirectUri | string | `"http://controlplane.wundergraph.local/v1/auth/callback"` |  |
| configuration.cdnBaseUrl | string | `"http://cosmo-cdn:8787"` | URL of the CDN to use for serving router configs and persistent operations |
| configuration.clickhouseDsn | string | `"http://default:changeme@cosmo-clickhouse:8123?database=cosmo"` |  |
| configuration.clickhouseMigrationDsn | string | `"clickhouse://default:changeme@cosmo-clickhouse:9000?database=cosmo"` |  |
| configuration.databaseTlsCa | string | `""` | When connecting to a postgres instance over TLS. Accept a cert in PEM format (as one-line with \n) or file. |
| configuration.databaseTlsCert | string | `""` |  |
| configuration.databaseTlsKey | string | `""` |  |
| configuration.databaseUrl | string | `"postgres://postgres:changeme@cosmo-postgresql:5432/controlplane"` |  |
| configuration.debugSQL | bool | `false` |  |
| configuration.defaultBillingPlan | string | `""` | The default billing plan, eg `developer@1` |
| configuration.githubAppClientId | string | `""` |  |
| configuration.githubAppClientSecret | string | `""` |  |
| configuration.githubAppId | string | `""` |  |
| configuration.githubAppPrivateKey | string | `""` |  |
| configuration.githubAppWebhookSecret | string | `""` |  |
| configuration.logLevel | string | `"info"` |  |
| configuration.openAiApiKey | string | `""` |  |
| configuration.prometheus | object | `{"enabled":false,"gcpMonitoring":{"enabled":false,"interval":"60s","timeout":"50s"},"host":"127.0.0.1","path":"/metrics","port":8088}` | Use this section to configure prometheus metrics. |
| configuration.prometheus.enabled | bool | `false` | Enables prometheus metrics support. Default is false. |
| configuration.prometheus.gcpMonitoring.enabled | bool | `false` | Enables gcp support . Default is false. |
| configuration.prometheus.gcpMonitoring.interval | string | `"60s"` | Scrape interval. Default is "60s". |
| configuration.prometheus.gcpMonitoring.timeout | string | `"50s"` | Scrape timeout. Default is "50s". |
| configuration.prometheus.host | string | `"127.0.0.1"` | The host to bind to defautls to 127.0.0.1 to avoid opening the metrics endpoint by default. |
| configuration.prometheus.path | string | `"/metrics"` | The HTTP path where metrics are exposed. Default is "/metrics". |
| configuration.prometheus.port | int | `8088` | The port where metrics are exposed. Default is port 8088. |
| configuration.redisHost | string | `"cosmo-redis-master"` |  |
| configuration.redisPassword | string | `""` |  |
| configuration.redisPort | int | `6379` |  |
| configuration.redisTlsCa | string | `""` | When connecting to a redis instance over TLS. Accept a cert in PEM format (as one-line with \n) or file. |
| configuration.redisTlsCert | string | `""` |  |
| configuration.redisTlsKey | string | `""` |  |
| configuration.s3AccessKeyId | string | `""` | s3 access key id, can be used instead of [username]:[password] in the url |
| configuration.s3Endpoint | string | `""` | The endpoint of the S3 bucket. |
| configuration.s3ForcePathStyle | string | `"true"` | Forces usage of path style urls for S3. Default is true. |
| configuration.s3Region | string | `"auto"` | The region where the S3 bucket is located. |
| configuration.s3SecretAccessKey | string | `""` | s3 secret access key, can be used instead of [username]:[password] in the url |
| configuration.s3StorageUrl | string | `"http://minio:changeme@cosmo-minio:9000/cosmo"` |  |
| configuration.slackAppClientId | string | `""` |  |
| configuration.slackAppClientSecret | string | `""` |  |
| configuration.smtp | object | `{"enabled":false,"host":"smtp.postmarkapp.com","password":"","port":587,"requireTls":true,"secure":true,"username":""}` | Use this section to configure the smtp server. |
| configuration.smtp.enabled | bool | `false` | Enables the smtp server. Default is false. |
| configuration.smtp.host | string | `"smtp.postmarkapp.com"` | The host to connect to. Default is "smtp.postmarkapp.com". |
| configuration.smtp.password | string | `""` | The password to use. Default is "". |
| configuration.smtp.port | int | `587` | The port the smtp server listens to. Default is 587. |
| configuration.smtp.requireTls | bool | `true` | Forces the client to use STARTTLS. Default is true. |
| configuration.smtp.secure | bool | `true` | Defines if the connection should use SSL. Default is true. |
| configuration.smtp.username | string | `""` | The username to use. Default is "". |
| configuration.stripeSecretKey | string | `""` |  |
| configuration.stripeWebhookSecret | string | `""` |  |
| configuration.webhookSecret | string | `""` |  |
| configuration.webhookUrl | string | `""` |  |
| deploymentStrategy | object | `{}` |  |
| existingSecret | string | `""` | Existing secret in the same namespace containing the ControlPlane Secrets. The secret keys have to match with current secret. |
| extraEnvVars | list | `[]` | Allows to set additional environment variables on the container. Useful for global application non-specific settings. |
| fullnameOverride | string | `""` | String to fully override common.names.fullname template |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| image.registry | string | `"ghcr.io"` |  |
| image.repository | string | `"wundergraph/cosmo/controlplane"` |  |
| imagePullSecrets | list | `[]` |  |
| ingress.hosts | string | `nil` |  |
| ingress.tls | list | `[]` |  |
| jobs | object | `{"activateOrganization":{"additionalLabels":{},"enabled":false,"id":"123","slug":"foo"},"clickhouseMigration":{"additionalLabels":{}},"databaseMigration":{"additionalLabels":{}},"deactivateOrganization":{"additionalLabels":{},"enabled":false,"id":"123","reason":"","slug":"foo"},"deleteUser":{"additionalLabels":{},"email":"foo@wundergraph.com","enabled":false,"id":"123"},"seedOrganization":{"additionalLabels":{}}}` | Configure jobs to be executed in the control plane |
| jobs.activateOrganization | object | `{"additionalLabels":{},"enabled":false,"id":"123","slug":"foo"}` | Used to activate an organization and remove the scheduled deletion |
| jobs.activateOrganization.additionalLabels | object | `{}` | Adds additional labels to the job |
| jobs.activateOrganization.enabled | bool | `false` | Enables the job to be run |
| jobs.activateOrganization.id | string | `"123"` | The unique identifier of the organization |
| jobs.activateOrganization.slug | string | `"foo"` | The slug of the organization |
| jobs.clickhouseMigration.additionalLabels | object | `{}` | Adds additional labels to the clickhouse migration job (see: .Values.global.otelcollector) |
| jobs.databaseMigration.additionalLabels | object | `{}` | Adds additional labels to the database-migration job |
| jobs.deactivateOrganization | object | `{"additionalLabels":{},"enabled":false,"id":"123","reason":"","slug":"foo"}` | Used to deactivate an organization with a reason and schedule deletion |
| jobs.deactivateOrganization.additionalLabels | object | `{}` | Adds additional labels to the job |
| jobs.deactivateOrganization.enabled | bool | `false` | Enables the job to be run |
| jobs.deactivateOrganization.id | string | `"123"` | The unique identifier of the organization |
| jobs.deactivateOrganization.reason | string | `""` | The reason for deactivation |
| jobs.deactivateOrganization.slug | string | `"foo"` | The slug of the organization |
| jobs.deleteUser | object | `{"additionalLabels":{},"email":"foo@wundergraph.com","enabled":false,"id":"123"}` | Used to delete the user |
| jobs.deleteUser.additionalLabels | object | `{}` | Adds additional labels to the job |
| jobs.deleteUser.email | string | `"foo@wundergraph.com"` | The email of the user |
| jobs.deleteUser.enabled | bool | `false` | Enables the job to be run |
| jobs.deleteUser.id | string | `"123"` | The unique identifier of the user |
| jobs.seedOrganization.additionalLabels | object | `{}` | Adds additional labels to the job (see: .Values.global.seed) |
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

