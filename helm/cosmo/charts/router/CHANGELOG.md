# Changelog

## [0.15.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.14.0...helm-cosmo-router@0.15.0) (2025-09-10)


### Features

* pod label configuration in cosmo router helm chart ([#2200](https://github.com/wundergraph/cosmo/issues/2200)) ([b5b13a1](https://github.com/wundergraph/cosmo/commit/b5b13a110c7c4d08cb612f065a38bb82e5da461d))

## [0.14.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.13.1...helm-cosmo-router@0.14.0) (2025-08-15)


### Features

* bump helm versions ([#2142](https://github.com/wundergraph/cosmo/issues/2142)) ([df97e3d](https://github.com/wundergraph/cosmo/commit/df97e3d42ac942ddf2678b83e4d284f3d4ca63d8))

## [0.13.1](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.13.0...helm-cosmo-router@0.13.1) (2025-06-23)


### Bug Fixes

* **helm:** make sure version label handles longer image versions ([#1983](https://github.com/wundergraph/cosmo/issues/1983)) ([9f77f2f](https://github.com/wundergraph/cosmo/commit/9f77f2f0d0c8c5005c17b3fe00888bbee25f04c8))

## [0.13.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.12.0...helm-cosmo-router@0.13.0) (2025-06-13)


### Features

* **helm:** allow using config of a router from a file ([#1961](https://github.com/wundergraph/cosmo/issues/1961)) ([dfea253](https://github.com/wundergraph/cosmo/commit/dfea253502461bb80c47c05b9d211b9c757fcd4c))

## [0.12.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.11.0...helm-cosmo-router@0.12.0) (2025-06-09)


### Features

* **helm/router:** allow to insert additional labels in deployment ([#1937](https://github.com/wundergraph/cosmo/issues/1937)) ([6c650db](https://github.com/wundergraph/cosmo/commit/6c650db94116bafbd7ebcec3e21e2fb1c4962cea))

## [0.11.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.10.2...helm-cosmo-router@0.11.0) (2025-06-03)


### Features

* support mcp in router helm chart ([#1927](https://github.com/wundergraph/cosmo/issues/1927)) ([361e10a](https://github.com/wundergraph/cosmo/commit/361e10a2c6b4624c17898c9f9dc3b0befd1aefd2))

## [0.10.2](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.10.1...helm-cosmo-router@0.10.2) (2025-05-26)


### Bug Fixes

* extra volume mounts not rendered properly ([#1902](https://github.com/wundergraph/cosmo/issues/1902)) ([25828e7](https://github.com/wundergraph/cosmo/commit/25828e7feb7c5ec16ad229598824da519603a4dd))

## [0.10.1](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.10.0...helm-cosmo-router@0.10.1) (2025-04-14)


### Bug Fixes

* bump router chart version ([#1784](https://github.com/wundergraph/cosmo/issues/1784)) ([724aac3](https://github.com/wundergraph/cosmo/commit/724aac385956b0964f5132e0792a26923efbad99))

## [0.10.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.9.0...helm-cosmo-router@0.10.0) (2025-03-11)


### Features

* update package versions in helm charts ([#1676](https://github.com/wundergraph/cosmo/issues/1676)) ([95956dd](https://github.com/wundergraph/cosmo/commit/95956dd57ff67d49c26412202b70a4d48d0713e7))

## [0.9.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.8.1...helm-cosmo-router@0.9.0) (2024-10-11)


### Features

* make router config an explicit property update AppVersion ([#1263](https://github.com/wundergraph/cosmo/issues/1263)) ([0f89a1a](https://github.com/wundergraph/cosmo/commit/0f89a1ae6d74acf72400acc6bd5ead7a7895d0ce))


### Bug Fixes

* not respecting image.version in labels ([#1265](https://github.com/wundergraph/cosmo/issues/1265)) ([7c92c55](https://github.com/wundergraph/cosmo/commit/7c92c5576c3d713cc9c1349cf6f725f79ed75310))

## [0.8.1](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.8.0...helm-cosmo-router@0.8.1) (2024-09-16)


### Bug Fixes

* use appVersion by default, optimize keycloak startup time ([#1170](https://github.com/wundergraph/cosmo/issues/1170)) ([82c2bb9](https://github.com/wundergraph/cosmo/commit/82c2bb98d568fd7973fa700a84bec7ce4c0c51cf))

## [0.8.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.7.0...helm-cosmo-router@0.8.0) (2024-09-05)


### Features

* enable using HTTP(S)_PROXY in router  ([#1136](https://github.com/wundergraph/cosmo/issues/1136)) ([4600fdf](https://github.com/wundergraph/cosmo/commit/4600fdff6ab57541a6119e4e51180ed4403363a6))

## [0.7.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router@0.6.0...helm-cosmo-router@0.7.0) (2024-08-29)


### Features

* **cosmo:** add setting commonLabels on subchart resources ([#1120](https://github.com/wundergraph/cosmo/issues/1120)) ([030dc6d](https://github.com/wundergraph/cosmo/commit/030dc6da6652508d041bb34715d867d3a54db004))

## [0.6.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router-v0.5.0...helm-cosmo-router@0.6.0) (2024-08-14)


### Features

* add istioGateway and VirtualService to router helm chart ([#773](https://github.com/wundergraph/cosmo/issues/773)) ([2f30950](https://github.com/wundergraph/cosmo/commit/2f30950b1963f8d329bff54c0b7cd8548e4cf207))
* add metrics port to service and deployment spec of router helm chart ([#828](https://github.com/wundergraph/cosmo/issues/828)) ([3e9595b](https://github.com/wundergraph/cosmo/commit/3e9595b3b1ee99c8d7baadf19b42cff8b95a7a43))
* release helm charts ([#663](https://github.com/wundergraph/cosmo/issues/663)) ([b45c2da](https://github.com/wundergraph/cosmo/commit/b45c2da2a36d7360910eb7c3d2a3207c89d3bbdb))
* use Helm tpl function on .Values.commonConfiguration ([#840](https://github.com/wundergraph/cosmo/issues/840)) ([acb913e](https://github.com/wundergraph/cosmo/commit/acb913eca34747d6d37a7a84b5c4b188b0e8efa8))


### Bug Fixes

* fix default value for `extraEnvVars` in values for `router` ([#818](https://github.com/wundergraph/cosmo/issues/818)) ([f4cbc28](https://github.com/wundergraph/cosmo/commit/f4cbc28a3a51779eeaaa5108f44e56413caaf005))
* fix the expansion of selectors in the istio-gateway template for the router helm chart ([#785](https://github.com/wundergraph/cosmo/issues/785)) ([07a31a0](https://github.com/wundergraph/cosmo/commit/07a31a07af398c2bfa38be143400a1619aa5876d))

## [0.5.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-router-v0.4.0...helm-cosmo-router@0.5.0) (2024-08-10)


### Features

* add istioGateway and VirtualService to router helm chart ([#773](https://github.com/wundergraph/cosmo/issues/773)) ([2f30950](https://github.com/wundergraph/cosmo/commit/2f30950b1963f8d329bff54c0b7cd8548e4cf207))
* add metrics port to service and deployment spec of router helm chart ([#828](https://github.com/wundergraph/cosmo/issues/828)) ([3e9595b](https://github.com/wundergraph/cosmo/commit/3e9595b3b1ee99c8d7baadf19b42cff8b95a7a43))
* release helm charts ([#663](https://github.com/wundergraph/cosmo/issues/663)) ([b45c2da](https://github.com/wundergraph/cosmo/commit/b45c2da2a36d7360910eb7c3d2a3207c89d3bbdb))
* use Helm tpl function on .Values.commonConfiguration ([#840](https://github.com/wundergraph/cosmo/issues/840)) ([acb913e](https://github.com/wundergraph/cosmo/commit/acb913eca34747d6d37a7a84b5c4b188b0e8efa8))


### Bug Fixes

* fix default value for `extraEnvVars` in values for `router` ([#818](https://github.com/wundergraph/cosmo/issues/818)) ([f4cbc28](https://github.com/wundergraph/cosmo/commit/f4cbc28a3a51779eeaaa5108f44e56413caaf005))
* fix the expansion of selectors in the istio-gateway template for the router helm chart ([#785](https://github.com/wundergraph/cosmo/issues/785)) ([07a31a0](https://github.com/wundergraph/cosmo/commit/07a31a07af398c2bfa38be143400a1619aa5876d))
