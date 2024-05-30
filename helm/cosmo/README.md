# cosmo

For a detailed deployment guide of the chart, including the full documentation, see the [DEV.md](DEV.md) file.

![Version: 0.1.5](https://img.shields.io/badge/Version-0.1.5-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square)

This is the official Helm Chart for WunderGraph Cosmo - The Full Lifecycle GraphQL API Management Solution.

**Homepage:** <https://github.com/wundergraph/cosmo>

## Maintainers

| Name | Email | Url |
| ---- | ------ | --- |
| Dustin Deus | <dustin@wundergraph.com> | <https://github.com/StarpTech> |

## Requirements

| Repository | Name | Version |
|------------|------|---------|
|  | cdn | ^0 |
|  | controlplane | ^0 |
|  | graphqlmetrics | ^0 |
|  | otelcollector | ^0 |
|  | router | ^0 |
|  | studio | ^0 |
| https://charts.bitnami.com/bitnami | clickhouse | 5.0.2 |
| https://charts.bitnami.com/bitnami | keycloak | 17.3.1 |
| https://charts.bitnami.com/bitnami | minio | 12.10.0 |
| https://charts.bitnami.com/bitnami | postgresql | 12.8.0 |
| https://charts.bitnami.com/bitnami | redis | 18.9.1 |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| cdn.configuration.s3StorageUrl | string | `"http://minio:changeme@cosmo-minio:9000/cosmo"` |  |
| clickhouse.auth.password | string | `"changeme"` |  |
| clickhouse.auth.username | string | `"default"` |  |
| clickhouse.commonAnnotations."kapp.k14s.io/change-group" | string | `"cosmo.apps.clickhouse.wundergraph.com/deployment"` |  |
| clickhouse.image.tag | string | `"23.8.3"` |  |
| clickhouse.initdbScripts."db-init.sh" | string | `"#!/bin/bash\nset -e\nclickhouse-client --user $CLICKHOUSE_ADMIN_USER --password $CLICKHOUSE_ADMIN_PASSWORD -n <<-EOSQL\n  CREATE DATABASE IF NOT EXISTS cosmo;\nEOSQL\n"` |  |
| clickhouse.persistence.annotations."kapp.k14s.io/owned-for-deletion" | string | `""` |  |
| clickhouse.persistence.size | string | `"2Gi"` |  |
| clickhouse.replicaCount | int | `1` |  |
| clickhouse.shards | int | `1` |  |
| clickhouse.zookeeper.enabled | bool | `false` |  |
| controlplane.configuration.allowedOrigins[0] | string | `"http://studio.wundergraph.local"` |  |
| controlplane.configuration.authRedirectUri | string | `"http://controlplane.wundergraph.local/v1/auth/callback"` |  |
| controlplane.configuration.cdnBaseUrl | string | `"http://cosmo-cdn:8787"` |  |
| controlplane.configuration.clickhouseDsn | string | `"http://default:changeme@cosmo-clickhouse:8123/?database=cosmo"` |  |
| controlplane.configuration.clickhouseMigrationDsn | string | `"clickhouse://default:changeme@cosmo-clickhouse:9000/cosmo?dial_timeout=15s&max_execution_time=60"` |  |
| controlplane.configuration.databaseUrl | string | `"postgres://postgres:changeme@cosmo-postgresql:5432/controlplane"` |  |
| controlplane.configuration.debugSQL | bool | `false` |  |
| controlplane.configuration.logLevel | string | `"debug"` |  |
| controlplane.configuration.redisHost | string | `"cosmo-redis-master"` |  |
| controlplane.configuration.redisPort | int | `6379` |  |
| controlplane.configuration.s3StorageUrl | string | `"http://minio:changeme@cosmo-minio:9000/cosmo"` |  |
| global.cdn.enabled | bool | `true` |  |
| global.cdn.port | int | `8787` |  |
| global.cdn.webUrl | string | `"http://cdn.wundergraph.local"` |  |
| global.clickhouse.enabled | bool | `true` |  |
| global.controlplane.admissionJwtSecret | string | `"uXDxJLEvrw4aafPfrf3rRotCoBzRfPEW"` |  |
| global.controlplane.enabled | bool | `true` |  |
| global.controlplane.jwtSecret | string | `"1YQ4YR18WWNEWCLUIUKN5WVQ31HWDHEM"` |  |
| global.controlplane.port | int | `3001` |  |
| global.controlplane.webUrl | string | `"http://controlplane.wundergraph.local"` |  |
| global.graphqlmetrics.enabled | bool | `true` |  |
| global.graphqlmetrics.port | int | `4005` |  |
| global.graphqlmetrics.webUrl | string | `"http://graphqlmetrics.wundergraph.local"` |  |
| global.helmTests.enabled | bool | `false` |  |
| global.keycloak.adminPassword | string | `"changeme"` |  |
| global.keycloak.adminUser | string | `"admin"` |  |
| global.keycloak.apiUrl | string | `"http://cosmo-keycloak:8080"` |  |
| global.keycloak.clientId | string | `"studio"` |  |
| global.keycloak.database | string | `"keycloak"` |  |
| global.keycloak.databasePassword | string | `"changeme"` |  |
| global.keycloak.databaseSchema | string | `"public"` |  |
| global.keycloak.databaseUsername | string | `"postgres"` |  |
| global.keycloak.enabled | bool | `true` |  |
| global.keycloak.loginRealm | string | `"master"` |  |
| global.keycloak.port | int | `8080` |  |
| global.keycloak.realm | string | `"cosmo"` |  |
| global.keycloak.webUrl | string | `"http://keycloak.wundergraph.local"` |  |
| global.minio.enabled | bool | `true` |  |
| global.otelcollector.enabled | bool | `true` |  |
| global.otelcollector.port | int | `4318` |  |
| global.otelcollector.webUrl | string | `"http://otelcollector.wundergraph.local"` |  |
| global.postgresql.enabled | bool | `true` |  |
| global.redis.enabled | bool | `true` |  |
| global.router.enabled | bool | `false` | Disabled by default because we don't have a token yet |
| global.router.port | int | `3002` |  |
| global.router.webUrl | string | `"http://router.wundergraph.local"` |  |
| global.seed | object | `{"apiKey":"cosmo_669b576aaadc10ee1ae81d9193425705","enabled":true,"firstName":"Foo","lastName":"Bar","organizationName":"WunderGraph","organizationSlug":"wundergraph","userEmail":"foo@wundergraph.com","userPassword":"wunder@123"}` | Enable this once to seed a new organization |
| global.seed.apiKey | string | `"cosmo_669b576aaadc10ee1ae81d9193425705"` | Important: Remove this once the organization has been seeded and create a new secret |
| global.studio.enabled | bool | `true` |  |
| global.studio.port | int | `3000` |  |
| global.studio.webUrl | string | `"http://studio.wundergraph.local"` |  |
| graphqlmetrics.configuration.clickhouseDsn | string | `"clickhouse://default:changeme@cosmo-clickhouse:9000/cosmo?dial_timeout=15s&compress=lz4"` |  |
| ingress.annotations | object | `{}` |  |
| ingress.enabled | bool | `true` |  |
| keycloak.auth.adminPassword | string | `"changeme"` |  |
| keycloak.auth.adminUser | string | `"admin"` |  |
| keycloak.cache.enabled | bool | `false` |  |
| keycloak.externalDatabase.database | string | `"keycloak"` |  |
| keycloak.externalDatabase.host | string | `"cosmo-postgresql"` |  |
| keycloak.externalDatabase.port | int | `5432` |  |
| keycloak.externalDatabase.user | string | `"postgres"` |  |
| keycloak.extraEnvVars[0].name | string | `"KEYCLOAK_EXTRA_ARGS"` |  |
| keycloak.extraEnvVars[0].value | string | `"--import-realm --health-enabled=true"` |  |
| keycloak.extraEnvVars[1].name | string | `"KEYCLOAK_DATABASE_PASSWORD"` |  |
| keycloak.extraEnvVars[1].value | string | `"changeme"` |  |
| keycloak.extraVolumeMounts[0].mountPath | string | `"/opt/bitnami/keycloak/data/import/realm.json"` |  |
| keycloak.extraVolumeMounts[0].name | string | `"realm-config-volume"` |  |
| keycloak.extraVolumeMounts[0].readOnly | bool | `true` |  |
| keycloak.extraVolumeMounts[0].subPath | string | `"realm.json"` |  |
| keycloak.extraVolumes[0].configMap.name | string | `"keycloak-realm"` |  |
| keycloak.extraVolumes[0].name | string | `"realm-config-volume"` |  |
| keycloak.image.pullPolicy | string | `"IfNotPresent"` |  |
| keycloak.image.registry | string | `"ghcr.io"` |  |
| keycloak.image.repository | string | `"wundergraph/cosmo/keycloak"` |  |
| keycloak.image.tag | string | `"latest"` |  |
| keycloak.podAnnotations."kapp.k14s.io/change-group" | string | `"cosmo.apps.keycloak.wundergraph.com/deployment"` |  |
| keycloak.podAnnotations."kapp.k14s.io/change-rule.postgresql" | string | `"upsert after upserting cosmo.apps.postgresql.wundergraph.com/deployment"` |  |
| keycloak.postgresql.enabled | bool | `false` |  |
| keycloak.production | bool | `false` |  |
| keycloak.replicaCount | int | `1` |  |
| keycloak.service.ports.http | int | `8080` |  |
| keycloak.startupProbe.enabled | bool | `true` |  |
| minio.auth.rootPassword | string | `"changeme"` |  |
| minio.auth.rootUser | string | `"minio"` |  |
| minio.commonAnnotations."kapp.k14s.io/change-group" | string | `"cosmo.apps.minio.wundergraph.com/deployment"` |  |
| minio.defaultBuckets | string | `"cosmo"` |  |
| minio.persistence.annotations."kapp.k14s.io/owned-for-deletion" | string | `""` |  |
| minio.persistence.size | string | `"1Gi"` |  |
| minio.service.ports.minio | int | `9000` |  |
| minio.service.ports.minio_admin | int | `9001` |  |
| otelcollector.configuration.clickhouseDsn | string | `"clickhouse://default:changeme@cosmo-clickhouse:9000/cosmo?dial_timeout=15s&compress=lz4"` |  |
| postgresql.auth.database | string | `"controlplane"` |  |
| postgresql.auth.password | string | `"changeme"` |  |
| postgresql.auth.username | string | `"postgres"` |  |
| postgresql.commonAnnotations."kapp.k14s.io/change-group" | string | `"cosmo.apps.postgresql.wundergraph.com/deployment"` |  |
| postgresql.primary.initdb.password | string | `"changeme"` |  |
| postgresql.primary.initdb.scripts."01_init_keycloak.sql" | string | `"-- Create the database for Keycloak\nCREATE DATABASE \"keycloak\";\n"` |  |
| postgresql.primary.initdb.user | string | `"postgres"` |  |
| postgresql.primary.persistence.annotations."kapp.k14s.io/owned-for-deletion" | string | `""` |  |
| postgresql.primary.persistence.size | string | `"1Gi"` |  |
| postgresql.service.ports.postgres | int | `5432` |  |
| redis.auth.enabled | bool | `false` |  |
| redis.commonAnnotations."kapp.k14s.io/change-group" | string | `"cosmo.apps.redis.wundergraph.com/deployment"` |  |
| redis.commonConfiguration | string | `"# Enable AOF https://redis.io/topics/persistence#append-only-file\nappendonly yes\n# Enable RDB persistence (backup every 24h)\nsave \"86400 1\"\n# Disable maxmemory-policy https://redis.io/topics/lru-cache#eviction-policies\nmaxmemory-policy noeviction\n# Set maxmemory to 100mb\nmaxmemory 100mb"` |  |
| redis.master.persistence.annotations."kapp.k14s.io/owned-for-deletion" | string | `""` |  |
| redis.master.persistence.enabled | bool | `true` |  |
| redis.master.persistence.size | string | `"1Gi"` |  |
| redis.replica.replicaCount | int | `0` |  |
| router.configuration.cdnUrl | string | `"http://cosmo-cdn:8787"` | The URL of the Cosmo CDN. Should be internal to the cluster. |
| router.configuration.controlplaneUrl | string | `"http://cosmo-controlplane:3001"` | The URL of the Cosmo Controlplane. Should be internal to the cluster. |
| router.configuration.graphApiToken | string | `""` |  |
| router.configuration.graphqlMetricsCollectorUrl | string | `"http://cosmo-graphqlmetrics:4005"` | The URL of the Cosmo GraphQL Metrics Collector. Should be internal to the cluster. |
| router.configuration.logLevel | string | `"info"` | Log level of the router |
| router.configuration.otelCollectorUrl | string | `"http://cosmo-otelcollector:4318"` | The URL of the Cosmo GraphQL OTEL Collector. Should be internal to the cluster. |
| router.deploymentStrategy.rollingUpdate.maxSurge | int | `1` |  |
| router.deploymentStrategy.rollingUpdate.maxUnavailable | int | `0` |  |
| router.prometheus.enabled | bool | `true` | Enables prometheus metrics support. Default is true. |
| router.prometheus.path | string | `"/metrics"` | The HTTP path where metrics are exposed. Default is "/metrics". |
| router.prometheus.port | int | `8088` | The port where metrics are exposed. Default is port 8088. |
| router.terminationGracePeriodSeconds | int | `60` |  |

