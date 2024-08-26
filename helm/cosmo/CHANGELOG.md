# Changelog

## [0.9.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.8.0...helm-cosmo@0.9.0) (2024-08-26)


### Features

* **controlplane:** enable custom job labels and pass common labels  ([#1112](https://github.com/wundergraph/cosmo/issues/1112)) ([e1006b9](https://github.com/wundergraph/cosmo/commit/e1006b935e5f1003f1818544c6c455bebc0929de))

## [0.8.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-v0.7.0...helm-cosmo@0.8.0) (2024-08-14)


### Features

* add metrics port to service and deployment spec of router helm chart ([#828](https://github.com/wundergraph/cosmo/issues/828)) ([3e9595b](https://github.com/wundergraph/cosmo/commit/3e9595b3b1ee99c8d7baadf19b42cff8b95a7a43))
* **controlplane:** add overriding the mailing options ([#1008](https://github.com/wundergraph/cosmo/issues/1008)) ([f19ec90](https://github.com/wundergraph/cosmo/commit/f19ec90ca2cb2259384c2119291c43d4b5bcd11e))
* enable native support for prometheus for all instrumented ([#994](https://github.com/wundergraph/cosmo/issues/994)) ([54876dc](https://github.com/wundergraph/cosmo/commit/54876dc69fd98259463e6514c6c02e2b006ac807))
* **graphqlmetrics:** enable prometheus metrics ([#963](https://github.com/wundergraph/cosmo/issues/963)) ([48f54fe](https://github.com/wundergraph/cosmo/commit/48f54fed6444fd6ffc25a86fe45225b717fabca4))
* instrument controlplane with metrics ([#943](https://github.com/wundergraph/cosmo/issues/943)) ([0e74d6c](https://github.com/wundergraph/cosmo/commit/0e74d6c9c7699a335bb56d74bfc0cf3b2fdbc70e))
* k8 jobs for user deletion and org activation ([#958](https://github.com/wundergraph/cosmo/issues/958)) ([c216414](https://github.com/wundergraph/cosmo/commit/c216414fac9e582548073e87cfeb1c795315122a))
* **otelcollector:** enable prometheus support for otelcollector and export it ([#984](https://github.com/wundergraph/cosmo/issues/984)) ([786391f](https://github.com/wundergraph/cosmo/commit/786391fc48def4648558042ef2cb05c99b010a7e))
* release helm charts ([#663](https://github.com/wundergraph/cosmo/issues/663)) ([b45c2da](https://github.com/wundergraph/cosmo/commit/b45c2da2a36d7360910eb7c3d2a3207c89d3bbdb))
* router config signature validation through custom admission webhooks ([#628](https://github.com/wundergraph/cosmo/issues/628)) ([384fd7e](https://github.com/wundergraph/cosmo/commit/384fd7e3372479e96fccc4fc771dc4e9f9c84754))
* use offline token, refresh token implementation ([#686](https://github.com/wundergraph/cosmo/issues/686)) ([4429319](https://github.com/wundergraph/cosmo/commit/442931935e979f53b0b093fbad217a2c91807f8e))


### Bug Fixes

* create database clickhouse, arm incompatibilities ([c88dd50](https://github.com/wundergraph/cosmo/commit/c88dd507318334d40e9352a69a5df32d047d94f4))
* org activation jobs and delete user script ([#966](https://github.com/wundergraph/cosmo/issues/966)) ([a81b4a5](https://github.com/wundergraph/cosmo/commit/a81b4a57ab5702703fd6218d90c200c5a8a543f5))
* package permission on action ([#1072](https://github.com/wundergraph/cosmo/issues/1072)) ([0a3e1fd](https://github.com/wundergraph/cosmo/commit/0a3e1fd7553355da25e026e6f29492a3b84d8373))
* pass database certs when seeding ([#699](https://github.com/wundergraph/cosmo/issues/699)) ([4bd0587](https://github.com/wundergraph/cosmo/commit/4bd0587e2a052cec597d9af2c1255fd041c3c239))
* update wgc commands ./helm ([#712](https://github.com/wundergraph/cosmo/issues/712)) ([1218247](https://github.com/wundergraph/cosmo/commit/1218247b89406b7df4d5e1d16cf0a231faf3c138))
