# Changelog

## [0.8.0](https://github.com/wundergraph/cosmo/compare/helm-cosmo-v0.7.0...helm-cosmo@0.8.0) (2024-08-09)


### Features

* add metrics port to service and deployment spec of router helm chart ([#828](https://github.com/wundergraph/cosmo/issues/828)) ([3e9595b](https://github.com/wundergraph/cosmo/commit/3e9595b3b1ee99c8d7baadf19b42cff8b95a7a43))
* **controlplane:** add overriding the mailing options ([#1008](https://github.com/wundergraph/cosmo/issues/1008)) ([f19ec90](https://github.com/wundergraph/cosmo/commit/f19ec90ca2cb2259384c2119291c43d4b5bcd11e))
* enable native support for prometheus for all instrumented ([#994](https://github.com/wundergraph/cosmo/issues/994)) ([54876dc](https://github.com/wundergraph/cosmo/commit/54876dc69fd98259463e6514c6c02e2b006ac807))
* **graphqlmetrics:** enable prometheus metrics ([#963](https://github.com/wundergraph/cosmo/issues/963)) ([48f54fe](https://github.com/wundergraph/cosmo/commit/48f54fed6444fd6ffc25a86fe45225b717fabca4))
* instrument controlplane with metrics ([#943](https://github.com/wundergraph/cosmo/issues/943)) ([0e74d6c](https://github.com/wundergraph/cosmo/commit/0e74d6c9c7699a335bb56d74bfc0cf3b2fdbc70e))
* k8 jobs for user deletion and org activation ([#958](https://github.com/wundergraph/cosmo/issues/958)) ([c216414](https://github.com/wundergraph/cosmo/commit/c216414fac9e582548073e87cfeb1c795315122a))
* **otelcollector:** enable prometheus support for otelcollector and export it ([#984](https://github.com/wundergraph/cosmo/issues/984)) ([786391f](https://github.com/wundergraph/cosmo/commit/786391fc48def4648558042ef2cb05c99b010a7e))
* use offline token, refresh token implementation ([#686](https://github.com/wundergraph/cosmo/issues/686)) ([4429319](https://github.com/wundergraph/cosmo/commit/442931935e979f53b0b093fbad217a2c91807f8e))


### Bug Fixes

* a test ([7536fc3](https://github.com/wundergraph/cosmo/commit/7536fc396ec82a82a25111782d3dd116394d3e1f))
* a test for the release process ([9750fbc](https://github.com/wundergraph/cosmo/commit/9750fbcd8001f98332e798ffcfb4b479627afd2b))
* another test ([f9d33c6](https://github.com/wundergraph/cosmo/commit/f9d33c63d399091f178e69c8afaa73976b034e97))
* another Test ([794138a](https://github.com/wundergraph/cosmo/commit/794138aea63b234c2229a1195802ab4d1ac7cdb2))
* **cdn:** something that was broken ([a1592fd](https://github.com/wundergraph/cosmo/commit/a1592fd531627d545ef581bb473be7a9a353e2ab))
* create database clickhouse, arm incompatibilities ([c88dd50](https://github.com/wundergraph/cosmo/commit/c88dd507318334d40e9352a69a5df32d047d94f4))
* org activation jobs and delete user script ([#966](https://github.com/wundergraph/cosmo/issues/966)) ([a81b4a5](https://github.com/wundergraph/cosmo/commit/a81b4a57ab5702703fd6218d90c200c5a8a543f5))
* pass database certs when seeding ([#699](https://github.com/wundergraph/cosmo/issues/699)) ([4bd0587](https://github.com/wundergraph/cosmo/commit/4bd0587e2a052cec597d9af2c1255fd041c3c239))
* something ([2067805](https://github.com/wundergraph/cosmo/commit/206780534ed9e70e92b23f62e2c0ad0b82861e82))
* sthg ([eac6635](https://github.com/wundergraph/cosmo/commit/eac66359bef73820468135d70fa4b6390b7da7b6))
* test ([a7a68af](https://github.com/wundergraph/cosmo/commit/a7a68af6220c0ea51bde631546426b2d4c250f37))
* test ([0244216](https://github.com/wundergraph/cosmo/commit/02442164c4ee83795748d3ec3b9be24782c59a24))
* test ([355af99](https://github.com/wundergraph/cosmo/commit/355af995fbe41636aeb71917aed00234256aaaa2))
* test ([82b8469](https://github.com/wundergraph/cosmo/commit/82b8469448dd5d78fe336a11465b14e24fc2487b))
* test ([00910a5](https://github.com/wundergraph/cosmo/commit/00910a503ea27c0b19766ecb52f9e235d0e173bb))
* test ([0da7dc4](https://github.com/wundergraph/cosmo/commit/0da7dc4766de2dbe5a4b1e0ed323c083d6b0cd45))
* test ([776deb0](https://github.com/wundergraph/cosmo/commit/776deb05dd47aca1d8ca8e01432c09fcb4598a6c))
* test ([08bee9d](https://github.com/wundergraph/cosmo/commit/08bee9d670fcc9c408e9d1f6c95458031016a001))
* test ([b9e165e](https://github.com/wundergraph/cosmo/commit/b9e165e10c6813f4bcd8ecbf64b98a70f20200bc))
* test ([5f00995](https://github.com/wundergraph/cosmo/commit/5f009958083c2ba5a129e7623ad7da6a3bf3d7c1))
* test workflow ([7e46ac0](https://github.com/wundergraph/cosmo/commit/7e46ac066bc7a4be2ccb0cb5ef3fa05e6615a6e2))
* trigger workflow ([85f3769](https://github.com/wundergraph/cosmo/commit/85f376980ea5f48601f7c266c1b50179f975d38b))
* trigger workflow ([163ce85](https://github.com/wundergraph/cosmo/commit/163ce8572655d83d6dd1d37668a938fde6733525))
* update wgc commands ./helm ([#712](https://github.com/wundergraph/cosmo/issues/712)) ([1218247](https://github.com/wundergraph/cosmo/commit/1218247b89406b7df4d5e1d16cf0a231faf3c138))
