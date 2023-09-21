# Change Log
Binaries are attached to the github release otherwise all images can be found [here](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.20.0](https://github.com/wundergraph/cosmo/compare/router@0.19.1...router@0.20.0) (2023-09-21)

### Features

* don't poll router config when config hasn't changed ([#105](https://github.com/wundergraph/cosmo/issues/105)) ([ea33961](https://github.com/wundergraph/cosmo/commit/ea339617a7d1724fd9b727953db5d591e50241dd)) (@StarpTech)

## [0.19.1](https://github.com/wundergraph/cosmo/compare/router@0.19.0...router@0.19.1) (2023-09-20)

**Note:** Version bump only for package router

# [0.19.0](https://github.com/wundergraph/cosmo/compare/router@0.18.0...router@0.19.0) (2023-09-20)

### Bug Fixes

* composition false flag ([#97](https://github.com/wundergraph/cosmo/issues/97)) ([a25cc7f](https://github.com/wundergraph/cosmo/commit/a25cc7f13adbf6f8e29113f49d364fc1f8bb9e81)) (@Aenimus)

### Features

* store subgraphs in router config ([#61](https://github.com/wundergraph/cosmo/issues/61)) ([de7b132](https://github.com/wundergraph/cosmo/commit/de7b13244755acd49c38ff1e6c537234ab506960)) (@thisisnithin)

# [0.18.0](https://github.com/wundergraph/cosmo/compare/router@0.17.1...router@0.18.0) (2023-09-19)

### Bug Fixes

* don't poll when static router config is provided ([#88](https://github.com/wundergraph/cosmo/issues/88)) ([ef75dc5](https://github.com/wundergraph/cosmo/commit/ef75dc5bc25b7a2cad2fe1f270cb0228da7a0d73)) (@StarpTech)

### Features

* make request timeout configurable ([#87](https://github.com/wundergraph/cosmo/issues/87)) ([6349b24](https://github.com/wundergraph/cosmo/commit/6349b2461564de1cf2942647b43e5d7587f3aed7)) (@StarpTech)

## [0.17.1](https://github.com/wundergraph/cosmo/compare/router@0.17.0...router@0.17.1) (2023-09-18)

### Bug Fixes

* address __typename and fragment engine issues ([#85](https://github.com/wundergraph/cosmo/issues/85)) ([4bad60b](https://github.com/wundergraph/cosmo/commit/4bad60b253002c1738ab54a0abb5178b19c75aa8)) (@Aenimus)

# [0.17.0](https://github.com/wundergraph/cosmo/compare/router@0.16.0...router@0.17.0) (2023-09-18)

### Bug Fixes

* add handlers to the custom transport / throw error on invalid cfg path ([#83](https://github.com/wundergraph/cosmo/issues/83)) ([bc547f4](https://github.com/wundergraph/cosmo/commit/bc547f42457dd8e6dde1cc0134e6f47d95e41382)) (@StarpTech)

### Features

* **config:** support configuration of graphql path ([#82](https://github.com/wundergraph/cosmo/issues/82)) ([5fcb39a](https://github.com/wundergraph/cosmo/commit/5fcb39a07c8eecaafa6a013d63a3bac243215257)) (@paulpdaniels)

# [0.16.0](https://github.com/wundergraph/cosmo/compare/router@0.15.0...router@0.16.0) (2023-09-17)

### Features

* enable client compression for metrics and traces ([#78](https://github.com/wundergraph/cosmo/issues/78)) ([c7502ab](https://github.com/wundergraph/cosmo/commit/c7502abb705f88f7c4ef0fbb97262c521668597a)) (@StarpTech)
* implement backoff jitter retry mechanism ([#79](https://github.com/wundergraph/cosmo/issues/79)) ([5586dd4](https://github.com/wundergraph/cosmo/commit/5586dd47cffba8ca7eeee57cd95823cf69c10cc0)) (@StarpTech)

# [0.15.0](https://github.com/wundergraph/cosmo/compare/router@0.14.2...router@0.15.0) (2023-09-16)

### Features

* only generate node api for router ([#76](https://github.com/wundergraph/cosmo/issues/76)) ([9307648](https://github.com/wundergraph/cosmo/commit/93076481437030fa6e348dccbc74591f91878f57)) (@StarpTech)
* webhooks ([#66](https://github.com/wundergraph/cosmo/issues/66)) ([dbb281f](https://github.com/wundergraph/cosmo/commit/dbb281fda114ddb6be309b3336d0668d705e7bc9)) (@thisisnithin)

## [0.14.2](https://github.com/wundergraph/cosmo/compare/router@0.14.1...router@0.14.2) (2023-09-14)

**Note:** Version bump only for package router

## [0.14.1](https://github.com/wundergraph/cosmo/compare/router@0.14.0...router@0.14.1) (2023-09-14)

**Note:** Version bump only for package router

# [0.14.0](https://github.com/wundergraph/cosmo/compare/router@0.13.0...router@0.14.0) (2023-09-13)

### Features

* add user registration ([#57](https://github.com/wundergraph/cosmo/issues/57)) ([c1d1841](https://github.com/wundergraph/cosmo/commit/c1d184192511f015c4b33db91d7342a0bb35710e)) (@JivusAyrus)

# [0.13.0](https://github.com/wundergraph/cosmo/compare/router@0.12.0...router@0.13.0) (2023-09-12)

### Features

* use new engine resolver ([#37](https://github.com/wundergraph/cosmo/issues/37)) ([cc087ad](https://github.com/wundergraph/cosmo/commit/cc087ad5164333b8706555673262c946ee500095)) (@devsergiy)

# [0.12.0](https://github.com/wundergraph/cosmo/compare/router@0.11.0...router@0.12.0) (2023-09-11)

### Bug Fixes

* update engine to support schema extension without body ([#55](https://github.com/wundergraph/cosmo/issues/55)) ([92b2d4d](https://github.com/wundergraph/cosmo/commit/92b2d4d86d15534eeeabf9c96bd0edc4cb546aed)) (@Aenimus)

### Features

* add introspect subgraph command ([#44](https://github.com/wundergraph/cosmo/issues/44)) ([bf376cd](https://github.com/wundergraph/cosmo/commit/bf376cd75382b16659efb670ea54494f691328aa)) (@JivusAyrus)
* introspect subgraphs in cli ([#53](https://github.com/wundergraph/cosmo/issues/53)) ([2bd9f95](https://github.com/wundergraph/cosmo/commit/2bd9f95cd3ac13e878a12ab526d575c9b1daf248)) (@JivusAyrus)

# [0.11.0](https://github.com/wundergraph/cosmo/compare/router@0.10.0...router@0.11.0) (2023-09-10)

### Features

* implement header rule engine ([#49](https://github.com/wundergraph/cosmo/issues/49)) ([a92ba05](https://github.com/wundergraph/cosmo/commit/a92ba0577df17bfdc4ffbac4721ff248929367ac)) (@StarpTech)
* simplify OnOriginResponse hook ([#50](https://github.com/wundergraph/cosmo/issues/50)) ([01ced4b](https://github.com/wundergraph/cosmo/commit/01ced4b80d1aece398a735e0058a575cfe7eba5a)) (@StarpTech)

# [0.10.0](https://github.com/wundergraph/cosmo/compare/router@0.9.3...router@0.10.0) (2023-09-08)

### Features

* implement live-, readi-ness handlers ([#48](https://github.com/wundergraph/cosmo/issues/48)) ([f122211](https://github.com/wundergraph/cosmo/commit/f122211e3ff37a7924559ee0d09320fc6d24a379)) (@StarpTech)

## [0.9.3](https://github.com/wundergraph/cosmo/compare/router@0.9.2...router@0.9.3) (2023-09-08)

### Bug Fixes

* fix migration issues ([#47](https://github.com/wundergraph/cosmo/issues/47)) ([048398a](https://github.com/wundergraph/cosmo/commit/048398a3b5c4effaa1d7f6387c4ca02fbd28700c)) (@Aenimus)

## [0.9.2](https://github.com/wundergraph/cosmo/compare/router@0.9.1...router@0.9.2) (2023-09-07)

### Bug Fixes

* disable pretty print in JSON mode, allow to disable otel metrics ([#45](https://github.com/wundergraph/cosmo/issues/45)) ([b3d4a4e](https://github.com/wundergraph/cosmo/commit/b3d4a4e647b26c44a160f150d4b66f0b023c6d59)) (@StarpTech)

## [0.9.1](https://github.com/wundergraph/cosmo/compare/router@0.9.0...router@0.9.1) (2023-09-07)

**Note:** Version bump only for package router

# [0.9.0](https://github.com/wundergraph/cosmo/compare/router@0.8.0...router@0.9.0) (2023-09-06)

### Features

* custom router modules ([#36](https://github.com/wundergraph/cosmo/issues/36)) ([75825d9](https://github.com/wundergraph/cosmo/commit/75825d95449f0015b4efddca20afbc591ff8ddb5)) (@StarpTech)

# [0.8.0](https://github.com/wundergraph/cosmo/compare/router@0.7.0...router@0.8.0) (2023-09-06)

### Features

* add argument configuration ([#10](https://github.com/wundergraph/cosmo/issues/10)) ([48d909f](https://github.com/wundergraph/cosmo/commit/48d909f4de954c2401b557ed6a9f58915388f679)) (@Aenimus)

# [0.7.0](https://github.com/wundergraph/cosmo/compare/router@0.6.3...router@0.7.0) (2023-09-02)

### Features

* add prometheus ([#31](https://github.com/wundergraph/cosmo/issues/31)) ([d318c73](https://github.com/wundergraph/cosmo/commit/d318c7331d77d21d0246344d76fbe0fc6b617174)) (@StarpTech)

## [0.6.3](https://github.com/wundergraph/cosmo/compare/router@0.6.2...router@0.6.3) (2023-08-31)

### Bug Fixes

* use int counter for inflight requests metric ([#22](https://github.com/wundergraph/cosmo/issues/22)) ([7d69de2](https://github.com/wundergraph/cosmo/commit/7d69de2231ab6c82e65acf56b90936b467c0caa0)) (@StarpTech)

## [0.6.2](https://github.com/wundergraph/cosmo/compare/router@0.6.1...router@0.6.2) (2023-08-29)

### Bug Fixes

* use empty url to use the same url as the playground ([#21](https://github.com/wundergraph/cosmo/issues/21)) ([0eaa1a3](https://github.com/wundergraph/cosmo/commit/0eaa1a34eafce89bbf5685f7bf4a031c659ad820)) (@StarpTech)

## [0.6.1](https://github.com/wundergraph/cosmo/compare/router@0.6.0...router@0.6.1) (2023-08-29)

### Bug Fixes

* do not include _Service and _entities in the federated graph ([#19](https://github.com/wundergraph/cosmo/issues/19)) ([97201ed](https://github.com/wundergraph/cosmo/commit/97201ed337205d96e55d1524e471a9116d93a389)) (@JivusAyrus)

# [0.6.0](https://github.com/wundergraph/cosmo/compare/router@0.5.0...router@0.6.0) (2023-08-28)

### Features

* implement metric backend ([#13](https://github.com/wundergraph/cosmo/issues/13)) ([4c0a790](https://github.com/wundergraph/cosmo/commit/4c0a790852542475e6d0533fdeea24f5b226bd7d)) (@StarpTech)

# 0.5.0 (2023-08-24)

### Features

* dummy change to test release ([33ef04a](https://github.com/wundergraph/cosmo/commit/33ef04a66f5cd7096fbaf0f9766ccdd0c272f4a6)) (@StarpTech)
* prepare release pipeline ([#3](https://github.com/wundergraph/cosmo/issues/3)) ([b6156fc](https://github.com/wundergraph/cosmo/commit/b6156fcf66254f08c3fba30f3987550ff121c3e5)) (@StarpTech)

## [0.4.2](https://github.com/wundergraph/cosmo/compare/router@0.3.0...router@0.4.2) (2023-08-24)

**Note:** Version bump only for package router

## [0.4.1](https://github.com/wundergraph/cosmo/compare/router@0.3.0...router@0.4.1) (2023-08-24)

**Note:** Version bump only for package router

# 0.4.0 (2023-08-24)

### Features

* dummy change to test release ([33ef04a](https://github.com/wundergraph/cosmo/commit/33ef04a66f5cd7096fbaf0f9766ccdd0c272f4a6)) (@StarpTech)
* prepare release pipeline ([#3](https://github.com/wundergraph/cosmo/issues/3)) ([b6156fc](https://github.com/wundergraph/cosmo/commit/b6156fcf66254f08c3fba30f3987550ff121c3e5)) (@StarpTech)

# 0.3.0 (2023-08-24)

### Features

* dummy change to test release ([33ef04a](https://github.com/wundergraph/cosmo/commit/33ef04a66f5cd7096fbaf0f9766ccdd0c272f4a6)) (@StarpTech)
* prepare release pipeline ([#3](https://github.com/wundergraph/cosmo/issues/3)) ([b6156fc](https://github.com/wundergraph/cosmo/commit/b6156fcf66254f08c3fba30f3987550ff121c3e5)) (@StarpTech)

# 0.2.0 (2023-08-24)

### Features

* dummy change to test release ([33ef04a](https://github.com/wundergraph/cosmo/commit/33ef04a66f5cd7096fbaf0f9766ccdd0c272f4a6)) (@StarpTech)
* prepare release pipeline ([#3](https://github.com/wundergraph/cosmo/issues/3)) ([b6156fc](https://github.com/wundergraph/cosmo/commit/b6156fcf66254f08c3fba30f3987550ff121c3e5)) (@StarpTech)

# 0.1.0 (2023-08-24)

### Features

* dummy change to test release ([33ef04a](https://github.com/wundergraph/cosmo/commit/33ef04a66f5cd7096fbaf0f9766ccdd0c272f4a6)) (@StarpTech)
* prepare release pipeline ([#3](https://github.com/wundergraph/cosmo/issues/3)) ([b6156fc](https://github.com/wundergraph/cosmo/commit/b6156fcf66254f08c3fba30f3987550ff121c3e5)) (@StarpTech)

# 0.1.0 (2023-08-24)

### Features

* dummy change to test release ([33ef04a](https://github.com/wundergraph/cosmo/commit/33ef04a66f5cd7096fbaf0f9766ccdd0c272f4a6)) (@StarpTech)
* prepare release pipeline ([#3](https://github.com/wundergraph/cosmo/issues/3)) ([b6156fc](https://github.com/wundergraph/cosmo/commit/b6156fcf66254f08c3fba30f3987550ff121c3e5)) (@StarpTech)
