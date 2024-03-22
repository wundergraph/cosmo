# cosmo

![Version: 0.1.1](https://img.shields.io/badge/Version-0.1.1-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square)

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
| https://charts.bitnami.com/bitnami | clickhouse | ^5.0.2 |
| https://charts.bitnami.com/bitnami | keycloak | ^17.3.1 |
| https://charts.bitnami.com/bitnami | minio | 12.10.0 |
| https://charts.bitnami.com/bitnami | postgresql | 12.8.0 |
| https://charts.bitnami.com/bitnami | redis | 18.9.1 |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| global.cdn.enabled | bool | `false` |  |
| global.cdn.s3StorageUrl | string | `"http://minio:changeme@cosmo-minio:9000/cosmo"` |  |
| global.clickhouse.enabled | bool | `false` |  |
| global.controlplane.enabled | bool | `false` |  |
| global.controlplane.jwtSecret | string | `"1YQ4YR18WWNEWCLUIUKN5WVQ31HWDHEM"` |  |
| global.controlplane.port | int | `3001` |  |
| global.controlplane.webUrl | string | `"http://controlplane.wundergraph.local"` |  |
| global.graphqlmetrics.enabled | bool | `false` |  |
| global.graphqlmetrics.port | int | `4005` |  |
| global.graphqlmetrics.webUrl | string | `"http://graphqlmetrics.wundergraph.local"` |  |
| global.helmTests.enabled | bool | `false` |  |
| global.keycloak.adminPassword | string | `"changeme"` |  |
| global.keycloak.adminUser | string | `"admin"` |  |
| global.keycloak.apiUrl | string | `"http://cosmo-keycloak:8080"` |  |
| global.keycloak.enabled | bool | `false` |  |
| global.keycloak.port | int | `8080` |  |
| global.keycloak.realm | string | `"cosmo"` |  |
| global.keycloak.webUrl | string | `"http://keycloak.wundergraph.local"` |  |
| global.minio.enabled | bool | `false` |  |
| global.otelcollector.enabled | bool | `false` |  |
| global.otelcollector.port | int | `4318` |  |
| global.otelcollector.webUrl | string | `"http://otelcollector.wundergraph.local"` |  |
| global.postgresql.enabled | bool | `false` |  |
| global.redis.enabled | bool | `false` |  |
| global.router.enabled | bool | `false` |  |
| global.seed.apiKey | string | `"cosmo_669b576aaadc10ee1ae81d9193425705"` |  |
| global.seed.enabled | bool | `false` |  |
| global.seed.firstName | string | `"Foo"` |  |
| global.seed.lastName | string | `"Bar"` |  |
| global.seed.organizationName | string | `"WunderGraph"` |  |
| global.seed.organizationSlug | string | `"wundergraph"` |  |
| global.seed.userEmail | string | `"foo@wundergraph.com"` |  |
| global.seed.userName | string | `"foo"` |  |
| global.seed.userPassword | string | `"wunder@123"` |  |
| global.studio.enabled | bool | `false` |  |
| global.studio.port | int | `3000` |  |
| global.studio.webUrl | string | `"http://studio.wundergraph.local"` |  |
| ingress.enabled | bool | `false` |  |

