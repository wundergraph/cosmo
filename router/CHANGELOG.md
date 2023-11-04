# Change Log
Binaries are attached to the github release otherwise all images can be found [here](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.28.1](https://github.com/wundergraph/cosmo/compare/router@0.28.0...router@0.28.1) (2023-11-03)

**Note:** Version bump only for package router

# [0.28.0](https://github.com/wundergraph/cosmo/compare/router@0.27.2...router@0.28.0) (2023-11-03)

### Features

* operation checks (breaking change detection) ([#214](https://github.com/wundergraph/cosmo/issues/214)) ([0935413](https://github.com/wundergraph/cosmo/commit/093541305866327c5c44637603621e4a8053640d)) (@StarpTech)

## [0.27.2](https://github.com/wundergraph/cosmo/compare/router@0.27.1...router@0.27.2) (2023-11-02)

### Bug Fixes

* don't cancel metric collection on request cancellation ([#221](https://github.com/wundergraph/cosmo/issues/221)) ([888fc85](https://github.com/wundergraph/cosmo/commit/888fc8545637dc7aecde186f4e71fdb4f3fbd39a)) (@StarpTech)

## [0.27.1](https://github.com/wundergraph/cosmo/compare/router@0.27.0...router@0.27.1) (2023-11-01)

**Note:** Version bump only for package router

# [0.27.0](https://github.com/wundergraph/cosmo/compare/router@0.26.2...router@0.27.0) (2023-10-27)

### Features

* add support for authentication via JWKS ([#200](https://github.com/wundergraph/cosmo/issues/200)) ([cc59f9f](https://github.com/wundergraph/cosmo/commit/cc59f9f29b7b4ecf9360720f1c2478ae87f0f0be)) (@fiam)
* allow to exclude certain OTEL metrics and labels from prometheus export ([#209](https://github.com/wundergraph/cosmo/issues/209)) ([d20074c](https://github.com/wundergraph/cosmo/commit/d20074c4174d3e3591de8b4f31791ed511d8b357)) (@StarpTech)

## [0.26.2](https://github.com/wundergraph/cosmo/compare/router@0.26.1...router@0.26.2) (2023-10-26)

**Note:** Version bump only for package router

## [0.26.1](https://github.com/wundergraph/cosmo/compare/router@0.26.0...router@0.26.1) (2023-10-25)

### Bug Fixes

* consider request info when aggregating metrics ([#207](https://github.com/wundergraph/cosmo/issues/207)) ([8a85055](https://github.com/wundergraph/cosmo/commit/8a85055d22ebd7b8c63bc437d9de42cbe2ad06f5)) (@StarpTech)

# [0.26.0](https://github.com/wundergraph/cosmo/compare/router@0.25.2...router@0.26.0) (2023-10-25)

### Features

* schema field level usage analytics ([#174](https://github.com/wundergraph/cosmo/issues/174)) ([4f257a7](https://github.com/wundergraph/cosmo/commit/4f257a71984e991be2304b09a083c69da65200d2)) (@StarpTech)

## [0.25.2](https://github.com/wundergraph/cosmo/compare/router@0.25.1...router@0.25.2) (2023-10-25)

### Bug Fixes

* follow GraphQL over HTTP in error handling ([#199](https://github.com/wundergraph/cosmo/issues/199)) ([8006267](https://github.com/wundergraph/cosmo/commit/800626773929923299ed88af44c50b187287cd25)) (@StarpTech)
* interface union planning ([#201](https://github.com/wundergraph/cosmo/issues/201)) ([84f7fc3](https://github.com/wundergraph/cosmo/commit/84f7fc3379f57bc4a0f4da4e87f9c5b257561723)) (@devsergiy)

## [0.25.1](https://github.com/wundergraph/cosmo/compare/router@0.25.0...router@0.25.1) (2023-10-20)

**Note:** Version bump only for package router

# [0.25.0](https://github.com/wundergraph/cosmo/compare/router@0.24.1...router@0.25.0) (2023-10-20)

### Features

* add support for subscriptions ([#185](https://github.com/wundergraph/cosmo/issues/185)) ([5a78aa0](https://github.com/wundergraph/cosmo/commit/5a78aa01f60ac4184ac69b0bd72aa1ce467bff93)) (@fiam)
* **router:** support limiting request body size ([#190](https://github.com/wundergraph/cosmo/issues/190)) ([9021dde](https://github.com/wundergraph/cosmo/commit/9021dde603197af422190db16aa5ae8a2a263073)) (@StarpTech)

## [0.24.1](https://github.com/wundergraph/cosmo/compare/router@0.24.0...router@0.24.1) (2023-10-13)

### Bug Fixes

* normalization error when querying location in demo ([#178](https://github.com/wundergraph/cosmo/issues/178)) ([c0b6f92](https://github.com/wundergraph/cosmo/commit/c0b6f92d97bea7c74dfd625159136abba428a5a0)) (@devsergiy)
* swallowed errors in Router.Shutdown() ([#180](https://github.com/wundergraph/cosmo/issues/180)) ([b1bb006](https://github.com/wundergraph/cosmo/commit/b1bb0067bc73c23a3256a0c950e4e4fa2ee325c6)) (@fiam)

# [0.24.0](https://github.com/wundergraph/cosmo/compare/router@0.23.1...router@0.24.0) (2023-10-11)

### Bug Fixes

* usage of variables ([#179](https://github.com/wundergraph/cosmo/issues/179)) ([07d484b](https://github.com/wundergraph/cosmo/commit/07d484b076591e904c6b3a6eee3ff6c39596897e)) (@jensneuse)

### Features

* add graphql client info to metric attributes ([#176](https://github.com/wundergraph/cosmo/issues/176)) ([3f929a8](https://github.com/wundergraph/cosmo/commit/3f929a813435c8f7b198588ee465227058fa0b68)) (@StarpTech)

## [0.23.1](https://github.com/wundergraph/cosmo/compare/router@0.23.0...router@0.23.1) (2023-10-09)

### Bug Fixes

* extract default vars ([#172](https://github.com/wundergraph/cosmo/issues/172)) ([4f600bf](https://github.com/wundergraph/cosmo/commit/4f600bf598735114316e47a7a73e162eb3c07d6b)) (@jensneuse)

# [0.23.0](https://github.com/wundergraph/cosmo/compare/router@0.22.1...router@0.23.0) (2023-10-06)

### Features

* support subgraph router url override ([#152](https://github.com/wundergraph/cosmo/issues/152)) ([25cbf83](https://github.com/wundergraph/cosmo/commit/25cbf83f307a2c0986ad4bcdfa723cdd5dfd3f02)) (@StarpTech)
* use clickhouse as metric storage ([#137](https://github.com/wundergraph/cosmo/issues/137)) ([c5e9bf4](https://github.com/wundergraph/cosmo/commit/c5e9bf4b74d32f3cae7da27b6170300c1a462e52)) (@StarpTech)
* version metric meter ([#160](https://github.com/wundergraph/cosmo/issues/160)) ([1cdb5d5](https://github.com/wundergraph/cosmo/commit/1cdb5d5f62a9e49d2950b37144e547a153285038)) (@StarpTech)

## [0.22.1](https://github.com/wundergraph/cosmo/compare/router@0.22.0...router@0.22.1) (2023-09-30)

### Bug Fixes

* add operation attrs to request latency metric ([#143](https://github.com/wundergraph/cosmo/issues/143)) ([619326a](https://github.com/wundergraph/cosmo/commit/619326afe10dc62848cdb4785a2becefe9dddc7a)) (@StarpTech)

# [0.22.0](https://github.com/wundergraph/cosmo/compare/router@0.21.2...router@0.22.0) (2023-09-29)

### Bug Fixes

* add dive validation to Subgraphs field of HeaderRules config struct ([#132](https://github.com/wundergraph/cosmo/issues/132)) ([1eaa466](https://github.com/wundergraph/cosmo/commit/1eaa4669b1e8bf6d48f6ad9430614d909c15b2e8)) (@cs-clarence)
* collect request metrics as early as possible ([#139](https://github.com/wundergraph/cosmo/issues/139)) ([480d7a1](https://github.com/wundergraph/cosmo/commit/480d7a1afdf3596e8103aacd09cf6c8036e0a961)) (@StarpTech)
* set CORS header before passing through ([#142](https://github.com/wundergraph/cosmo/issues/142)) ([6008dc2](https://github.com/wundergraph/cosmo/commit/6008dc224c17e0113228a87539348e17de054050)) (@StarpTech)
* store operation Hash and Name correctly ([#141](https://github.com/wundergraph/cosmo/issues/141)) ([3d63163](https://github.com/wundergraph/cosmo/commit/3d631637fad1ec7abe41143d91c4010a4473c832)) (@StarpTech)
* track graphql errors in metrics ([#136](https://github.com/wundergraph/cosmo/issues/136)) ([db26994](https://github.com/wundergraph/cosmo/commit/db26994b40685418a3618a6927fbfe9a7073dce7)) (@StarpTech)

### Features

* improve trail version banner and handle trial version expiry ([#138](https://github.com/wundergraph/cosmo/issues/138)) ([0ecb2d1](https://github.com/wundergraph/cosmo/commit/0ecb2d150d9f9906631168aa0f588d2ca64ab590)) (@JivusAyrus)

## [0.21.2](https://github.com/wundergraph/cosmo/compare/router@0.21.1...router@0.21.2) (2023-09-27)

### Bug Fixes

* update engine to address entity array issues ([#131](https://github.com/wundergraph/cosmo/issues/131)) ([5e042e2](https://github.com/wundergraph/cosmo/commit/5e042e204709030e283d82e67e5a050ceb4397c6)) (@Aenimus)

## [0.21.1](https://github.com/wundergraph/cosmo/compare/router@0.21.0...router@0.21.1) (2023-09-27)

### Bug Fixes

* update engine to address representation issues ([#126](https://github.com/wundergraph/cosmo/issues/126)) ([7ca1360](https://github.com/wundergraph/cosmo/commit/7ca1360c954a272957d661a1689ed9a93715355d)) (@Aenimus)

# [0.21.0](https://github.com/wundergraph/cosmo/compare/router@0.20.2...router@0.21.0) (2023-09-25)

### Features

* expand environmental variables in config.yaml ([#108](https://github.com/wundergraph/cosmo/issues/108)) ([65269be](https://github.com/wundergraph/cosmo/commit/65269be92ce11c8d29814d04814515d19a910f01)) (@cs-clarence)
* **router:** make subgraph transport timeouts configurable ([#116](https://github.com/wundergraph/cosmo/issues/116)) ([fcd5a29](https://github.com/wundergraph/cosmo/commit/fcd5a2971057ebb3b38aa93de06f5dd1077471e3)) (@StarpTech)
* support per subgraph header rules ([#110](https://github.com/wundergraph/cosmo/issues/110)) ([8e2be3e](https://github.com/wundergraph/cosmo/commit/8e2be3e4eadf7bd534731a81901b60e9b0e3a94a)) (@cs-clarence)

## [0.20.2](https://github.com/wundergraph/cosmo/compare/router@0.20.1...router@0.20.2) (2023-09-25)

### Bug Fixes

* **router:** pass timeout correctly to the transport ([#111](https://github.com/wundergraph/cosmo/issues/111)) ([d234982](https://github.com/wundergraph/cosmo/commit/d234982925da122fe7bd488615255a0eb43ffbd4)) (@StarpTech)

## [0.20.1](https://github.com/wundergraph/cosmo/compare/router@0.20.0...router@0.20.1) (2023-09-22)

**Note:** Version bump only for package router

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
