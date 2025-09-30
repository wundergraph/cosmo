# Changelog

## [0.15.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.14.0...helm-cosmo@0.15.0) (2025-09-10)


### Features

* pod label configuration in cosmo router helm chart ([#2200](https://github.com/wundergraph/cosmo/issues/2200)) ([b5b13a1](https://github.com/wundergraph/cosmo/commit/b5b13a110c7c4d08cb612f065a38bb82e5da461d))

## [0.14.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.13.2...helm-cosmo@0.14.0) (2025-09-09)


### Features

* update images in values for bitnami helm charts ([#2190](https://github.com/wundergraph/cosmo/issues/2190)) ([a52c215](https://github.com/wundergraph/cosmo/commit/a52c2153304610e116274752a8269e41be887359))

## [0.13.2](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.13.1...helm-cosmo@0.13.2) (2025-08-15)


### Bug Fixes

* make the session cookie last as long as Keycloak's ([#2135](https://github.com/wundergraph/cosmo/issues/2135)) ([589bbc9](https://github.com/wundergraph/cosmo/commit/589bbc9c778c21879ddf088a38f419fb0b909219))

## [0.13.1](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.13.0...helm-cosmo@0.13.1) (2025-04-14)


### Bug Fixes

* bump umbrella version ([#1776](https://github.com/wundergraph/cosmo/issues/1776)) ([d5e8bab](https://github.com/wundergraph/cosmo/commit/d5e8bab892ef052370273f1db46617fc291317d8))

## [0.13.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.12.3...helm-cosmo@0.13.0) (2025-03-11)


### Features

* update package versions in helm charts ([#1676](https://github.com/wundergraph/cosmo/issues/1676)) ([95956dd](https://github.com/wundergraph/cosmo/commit/95956dd57ff67d49c26412202b70a4d48d0713e7))

## [0.12.3](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.12.2...helm-cosmo@0.12.3) (2024-11-22)


### Bug Fixes

* delete org and user workflows ([#1326](https://github.com/wundergraph/cosmo/issues/1326)) ([484898d](https://github.com/wundergraph/cosmo/commit/484898d885fc99dda8f81a2855173bd3628a5639))

## [0.12.2](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.12.1...helm-cosmo@0.12.2) (2024-10-11)


### Bug Fixes

* not respecting image.version in labels ([#1265](https://github.com/wundergraph/cosmo/issues/1265)) ([7c92c55](https://github.com/wundergraph/cosmo/commit/7c92c5576c3d713cc9c1349cf6f725f79ed75310))
* use volume name instead of config map name ([#1261](https://github.com/wundergraph/cosmo/issues/1261)) ([1a3a527](https://github.com/wundergraph/cosmo/commit/1a3a5273b2dda03e7cb1a5ee429aa14efcb058cc))

## [0.12.1](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.12.0...helm-cosmo@0.12.1) (2024-10-04)


### Bug Fixes

* make probes use the container/service port ([#1243](https://github.com/wundergraph/cosmo/issues/1243)) ([6fe4aef](https://github.com/wundergraph/cosmo/commit/6fe4aeff7b2c30a220c5b7e0c95a78ac39e330bd))

## [0.12.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.11.2...helm-cosmo@0.12.0) (2024-09-24)


### Features

* update clickhouse and keycloak charts ([#1214](https://github.com/wundergraph/cosmo/issues/1214)) ([dea6595](https://github.com/wundergraph/cosmo/commit/dea65954c8180d562527f425157ddfeaee83ad44))

## [0.11.2](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.11.1...helm-cosmo@0.11.2) (2024-09-16)


### Bug Fixes

* use appVersion by default, optimize keycloak startup time ([#1170](https://github.com/wundergraph/cosmo/issues/1170)) ([82c2bb9](https://github.com/wundergraph/cosmo/commit/82c2bb98d568fd7973fa700a84bec7ce4c0c51cf))

## [0.11.1](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.11.0...helm-cosmo@0.11.1) (2024-09-05)


### Bug Fixes

* cdn and controlplane not respecting nested subdomains ([#1145](https://github.com/wundergraph/cosmo/issues/1145)) ([1598d6e](https://github.com/wundergraph/cosmo/commit/1598d6e421cf3b51997050d006faf9655fd96fdd))

## [0.11.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.10.0...helm-cosmo@0.11.0) (2024-09-03)


### Features

* make cosmo usable with aws s3  ([#1135](https://github.com/wundergraph/cosmo/issues/1135)) ([aa9b72f](https://github.com/wundergraph/cosmo/commit/aa9b72fe59a02557f11c2eed494f7691fea236aa))

## [0.10.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo@0.9.0...helm-cosmo@0.10.0) (2024-08-29)


### Features

* **cosmo:** add setting commonLabels on subchart resources ([#1120](https://github.com/wundergraph/cosmo/issues/1120)) ([030dc6d](https://github.com/wundergraph/cosmo/commit/030dc6da6652508d041bb34715d867d3a54db004))
* **keycloak:** enable passing smtpServer to keycloak ([#1116](https://github.com/wundergraph/cosmo/issues/1116)) ([b278c75](https://github.com/wundergraph/cosmo/commit/b278c75a4fdfa572e8891a61ff3bc582947c7c2b))

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
