# cosmo

![Version: 0.0.1](https://img.shields.io/badge/Version-0.0.1-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.0.1](https://img.shields.io/badge/AppVersion-0.0.1-informational?style=flat-square)

This is the official Helm Chart for WunderGraph Cosmo - The Full Lifecycle GraphQL API Management Solution.

## Maintainers

| Name | Email | Url |
| ---- | ------ | --- |
| Dustin Deus | <dustin@wundergraph.com> | <https://github.com/StarpTech> |

## Requirements

| Repository | Name | Version |
|------------|------|---------|
|  | clickhouse | ^0 |
|  | controlplane | ^0 |
|  | graphqlmetrics | ^0 |
|  | keycloak | ^0 |
|  | otelcollector | ^0 |
|  | router | ^0 |
|  | studio | ^0 |
| https://charts.bitnami.com/bitnami | postgresql | 12.8.0 |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
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
| global.keycloak.adminUrl | string | `"http://keycloak.wundergraph.local"` |  |
| global.keycloak.adminUser | string | `"admin"` |  |
| global.keycloak.enabled | bool | `false` |  |
| global.keycloak.port | int | `8080` |  |
| global.keycloak.realm | string | `"cosmo"` |  |
| global.keycloak.webUrl | string | `"http://keycloak.wundergraph.local"` |  |
| global.otelcollector.enabled | bool | `false` |  |
| global.otelcollector.port | int | `4318` |  |
| global.otelcollector.webUrl | string | `"http://otelcollector.wundergraph.local"` |  |
| global.postgresql.enabled | bool | `false` |  |
| global.router.enabled | bool | `false` |  |
| global.seed.apiKey | string | `"cosmo_669b576aaadc10ee1ae81d9193425705"` |  |
| global.seed.enabled | bool | `false` |  |
| global.seed.firstName | string | `"Foo"` |  |
| global.seed.lastName | string | `"Bar"` |  |
| global.seed.organizationName | string | `"WunderGraph"` |  |
| global.seed.organizationSlug | string | `"wundergraph"` |  |
| global.seed.userEmail | string | `"foo@wundergraph.com"` |  |
| global.seed.userName | string | `"foo"` |  |
| global.seed.userPassword | string | `"bar"` |  |
| global.studio.enabled | bool | `false` |  |
| global.studio.port | int | `3000` |  |
| global.studio.webUrl | string | `"http://studio.wundergraph.local"` |  |
| ingress.enabled | bool | `false` |  |

