# Change Log
Binaries are attached to the github release otherwise all images can be found [here](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.79.0](https://github.com/wundergraph/cosmo/compare/router@0.78.0...router@0.79.0) (2024-04-03)

### Features

* subgraph error handling and instrumentation ([#675](https://github.com/wundergraph/cosmo/issues/675)) ([55a1215](https://github.com/wundergraph/cosmo/commit/55a1215f5c1ee417a7287c89520b1540c5066b82)) (@StarpTech)

# [0.78.0](https://github.com/wundergraph/cosmo/compare/router@0.77.0...router@0.78.0) (2024-03-25)

### Features

* add initial payload on WS origin connections ([#667](https://github.com/wundergraph/cosmo/issues/667)) ([989fa2f](https://github.com/wundergraph/cosmo/commit/989fa2fc9908c1067f74172facef317349f105e1)) (@jensneuse)

# [0.77.0](https://github.com/wundergraph/cosmo/compare/router@0.76.0...router@0.77.0) (2024-03-24)

### Features

* multi platform docker builds ([#665](https://github.com/wundergraph/cosmo/issues/665)) ([4c24d70](https://github.com/wundergraph/cosmo/commit/4c24d7075bd48cd946a1037bffc0c4fcaef74289)) (@StarpTech)

# [0.76.0](https://github.com/wundergraph/cosmo/compare/router@0.75.0...router@0.76.0) (2024-03-21)

### Features

* support authentication and multiple sources for nats edfs ([#635](https://github.com/wundergraph/cosmo/issues/635)) ([c6e5c31](https://github.com/wundergraph/cosmo/commit/c6e5c313bee098fcd50cca972a2423d28ecbad70)) (@Aenimus)

# [0.75.0](https://github.com/wundergraph/cosmo/compare/router@0.74.0...router@0.75.0) (2024-03-19)

### Bug Fixes

* change 'scopes' keyword to 'scope' ([#646](https://github.com/wundergraph/cosmo/issues/646)) ([9947d43](https://github.com/wundergraph/cosmo/commit/9947d437043a4926b9c2166a171c668e1fed15a6)) (@rickpasetto)

### Features

* allow exposing upgrade errors ([#647](https://github.com/wundergraph/cosmo/issues/647)) ([fdcd479](https://github.com/wundergraph/cosmo/commit/fdcd479b77b979554f6a1151ae52d5430966d06e)) (@jensneuse)

# [0.74.0](https://github.com/wundergraph/cosmo/compare/router@0.73.0...router@0.74.0) (2024-03-14)

### Features

* router config signature validation through custom admission webhooks ([#628](https://github.com/wundergraph/cosmo/issues/628)) ([384fd7e](https://github.com/wundergraph/cosmo/commit/384fd7e3372479e96fccc4fc771dc4e9f9c84754)) (@StarpTech)

# [0.73.0](https://github.com/wundergraph/cosmo/compare/router@0.72.0...router@0.73.0) (2024-03-13)

### Features

* add edfs validation; add event source name keys to config ([#624](https://github.com/wundergraph/cosmo/issues/624)) ([bf03bb8](https://github.com/wundergraph/cosmo/commit/bf03bb8fca1838fefebcb150f8924ec52fb8bdb5)) (@Aenimus)
* allow blocking mutations, subscriptions, non-persisted operations via router config ([#627](https://github.com/wundergraph/cosmo/issues/627)) ([8d26d36](https://github.com/wundergraph/cosmo/commit/8d26d3618cfe8e7b94ef1e20627849365b01cee0)) (@jensneuse)

# [0.72.0](https://github.com/wundergraph/cosmo/compare/router@0.71.2...router@0.72.0) (2024-03-09)

### Bug Fixes

* **router:** decode empty array of Regex in config ([#613](https://github.com/wundergraph/cosmo/issues/613)) ([73d296a](https://github.com/wundergraph/cosmo/commit/73d296a3cfec82b7d5c9efbe24ee0c389c43beb8)) (@StarpTech)

### Features

* improve planning time of a big queries ([#609](https://github.com/wundergraph/cosmo/issues/609)) ([ddb741b](https://github.com/wundergraph/cosmo/commit/ddb741b39115cbea7863eb89ec7e7e9dcdb11860)) (@devsergiy)

## [0.71.2](https://github.com/wundergraph/cosmo/compare/router@0.71.1...router@0.71.2) (2024-03-06)

### Bug Fixes

* don't log unexpected EOF client issues as errors ([#606](https://github.com/wundergraph/cosmo/issues/606)) ([3844424](https://github.com/wundergraph/cosmo/commit/3844424c5eee1a6c234908275a06d73551d3bdea)) (@StarpTech)

## [0.71.1](https://github.com/wundergraph/cosmo/compare/router@0.71.0...router@0.71.1) (2024-03-06)

### Bug Fixes

* subscription deduplication ([#603](https://github.com/wundergraph/cosmo/issues/603)) ([ca00f46](https://github.com/wundergraph/cosmo/commit/ca00f46878f5294106e293064a6b0d0559a56be7)) (@jensneuse)

# [0.71.0](https://github.com/wundergraph/cosmo/compare/router@0.70.0...router@0.71.0) (2024-03-05)

### Bug Fixes

* missing ART visuals on subgraph errors ([#598](https://github.com/wundergraph/cosmo/issues/598)) ([1934d7d](https://github.com/wundergraph/cosmo/commit/1934d7d801ac97ef3cdac2ad74799ca3416bd3c9)) (@thisisnithin)

### Features

* tls and mTLS server support ([#600](https://github.com/wundergraph/cosmo/issues/600)) ([9a7bdec](https://github.com/wundergraph/cosmo/commit/9a7bdec06097e9008100408faffc098ad6c04285)) (@StarpTech)

# [0.70.0](https://github.com/wundergraph/cosmo/compare/router@0.69.1...router@0.70.0) (2024-03-01)

### Bug Fixes

* custom scrollbar in ui and playground ([#587](https://github.com/wundergraph/cosmo/issues/587)) ([cee2b8d](https://github.com/wundergraph/cosmo/commit/cee2b8d43a50ae8c1ea5435736301a9e29079b59)) (@thisisnithin)

### Features

* unify OTEL tracing and ART ([#588](https://github.com/wundergraph/cosmo/issues/588)) ([d43c4d8](https://github.com/wundergraph/cosmo/commit/d43c4d8172ed3668a276477ede8aa57f6d4f9fd1)) (@thisisnithin)

## [0.69.1](https://github.com/wundergraph/cosmo/compare/router@0.69.0...router@0.69.1) (2024-02-27)

**Note:** Version bump only for package router

# [0.69.0](https://github.com/wundergraph/cosmo/compare/router@0.68.1...router@0.69.0) (2024-02-21)

### Features

* add option to redact IP in traces and logs ([#561](https://github.com/wundergraph/cosmo/issues/561)) ([6c63730](https://github.com/wundergraph/cosmo/commit/6c6373087df4520d1c8695a0ee8b2a8514cc3c0a)) (@StarpTech)

## [0.68.1](https://github.com/wundergraph/cosmo/compare/router@0.68.0...router@0.68.1) (2024-02-19)

### Bug Fixes

* listen port in config ([#553](https://github.com/wundergraph/cosmo/issues/553)) ([e0345bc](https://github.com/wundergraph/cosmo/commit/e0345bc02eafd96f553760e58510415c9c4fb654)) (@thisisnithin)
* router listen address default port ([#551](https://github.com/wundergraph/cosmo/issues/551)) ([8315997](https://github.com/wundergraph/cosmo/commit/8315997a48b1c5622f5017aef5b26a772f8cebcf)) (@thisisnithin)

# [0.68.0](https://github.com/wundergraph/cosmo/compare/router@0.67.0...router@0.68.0) (2024-02-18)

### Features

* **metrics:** collect OS type and enrich traces with resource instan… ([#546](https://github.com/wundergraph/cosmo/issues/546)) ([746b117](https://github.com/wundergraph/cosmo/commit/746b1175270b07fd7f3b9a9ae2077ee7dcc471c3)) (@StarpTech)

# [0.67.0](https://github.com/wundergraph/cosmo/compare/router@0.66.3...router@0.67.0) (2024-02-17)

### Features

* add support for absinthe WebSocket protocol ([#541](https://github.com/wundergraph/cosmo/issues/541)) ([740e960](https://github.com/wundergraph/cosmo/commit/740e960d48560f92854e63feec97c9dd62e29b01)) (@jensneuse)
* use json schema to validate and document router config ([#545](https://github.com/wundergraph/cosmo/issues/545)) ([ec700ba](https://github.com/wundergraph/cosmo/commit/ec700bae0224d3d0180b8d56800f48c9002dcee5)) (@StarpTech)

## [0.66.3](https://github.com/wundergraph/cosmo/compare/router@0.66.2...router@0.66.3) (2024-02-16)

### Bug Fixes

* disable variable export by default ([#536](https://github.com/wundergraph/cosmo/issues/536)) ([a100591](https://github.com/wundergraph/cosmo/commit/a1005919a28ee8c9e9c3b87c730e47db336bceec)) (@StarpTech)

## [0.66.2](https://github.com/wundergraph/cosmo/compare/router@0.66.1...router@0.66.2) (2024-02-14)

### Bug Fixes

* don't panic when config is nil ([#524](https://github.com/wundergraph/cosmo/issues/524)) ([bf9ee9e](https://github.com/wundergraph/cosmo/commit/bf9ee9ec3728212186511e8d9826c2276a54f55a)) (@StarpTech)

## [0.66.1](https://github.com/wundergraph/cosmo/compare/router@0.66.0...router@0.66.1) (2024-02-13)

### Bug Fixes

* distinguish between server and process uptime, fix uptime ch query ([#520](https://github.com/wundergraph/cosmo/issues/520)) ([6fc2b72](https://github.com/wundergraph/cosmo/commit/6fc2b7237cd029127f6913199c40dd61bb16a22b)) (@StarpTech)

# [0.66.0](https://github.com/wundergraph/cosmo/compare/router@0.65.0...router@0.66.0) (2024-02-13)

### Features

* router fleet management ([#515](https://github.com/wundergraph/cosmo/issues/515)) ([7f0deae](https://github.com/wundergraph/cosmo/commit/7f0deae98a2f58bd46927bdb2be8d615613b908f)) (@StarpTech)

# [0.65.0](https://github.com/wundergraph/cosmo/compare/router@0.64.0...router@0.65.0) (2024-02-13)

### Features

* implement graphql over sse ([#519](https://github.com/wundergraph/cosmo/issues/519)) ([4429d68](https://github.com/wundergraph/cosmo/commit/4429d688440d2315fca425a1f4238727da831c32)) (@jensneuse)

# [0.64.0](https://github.com/wundergraph/cosmo/compare/router@0.63.1...router@0.64.0) (2024-02-12)

### Features

* distributed rate limiting ([#499](https://github.com/wundergraph/cosmo/issues/499)) ([1d82cd1](https://github.com/wundergraph/cosmo/commit/1d82cd1abf985c3867ba31f78e05381f7ba40670)) (@jensneuse)

## [0.63.1](https://github.com/wundergraph/cosmo/compare/router@0.63.0...router@0.63.1) (2024-02-06)

**Note:** Version bump only for package router

# [0.63.0](https://github.com/wundergraph/cosmo/compare/router@0.62.0...router@0.63.0) (2024-02-06)

### Features

* consider only router root spans in the trace list ([#495](https://github.com/wundergraph/cosmo/issues/495)) ([b7639ab](https://github.com/wundergraph/cosmo/commit/b7639abcc4c2f367a651a65ffbc17238a049f635)) (@StarpTech)

# [0.62.0](https://github.com/wundergraph/cosmo/compare/router@0.61.2...router@0.62.0) (2024-02-05)

### Features

* allow to force root span on the router ([#486](https://github.com/wundergraph/cosmo/issues/486)) ([a1a2f64](https://github.com/wundergraph/cosmo/commit/a1a2f64558815267edc144e32da4297703743a86)) (@StarpTech)

## [0.61.2](https://github.com/wundergraph/cosmo/compare/router@0.61.1...router@0.61.2) (2024-02-05)

### Bug Fixes

* load schema from CP and sync router playground ([#489](https://github.com/wundergraph/cosmo/issues/489)) ([7bc4d89](https://github.com/wundergraph/cosmo/commit/7bc4d892fd21afc6d22bda07133b261599a7cd3e)) (@thisisnithin)
* refactor router trace instrumentation ([#485](https://github.com/wundergraph/cosmo/issues/485)) ([889d06c](https://github.com/wundergraph/cosmo/commit/889d06c95651bd44d136b89f0638faa4f25be8e2)) (@StarpTech)

## [0.61.1](https://github.com/wundergraph/cosmo/compare/router@0.61.0...router@0.61.1) (2024-02-01)

**Note:** Version bump only for package router

# [0.61.0](https://github.com/wundergraph/cosmo/compare/router@0.60.0...router@0.61.0) (2024-01-31)

### Features

* cosmo ai, generate docs on publish ([#466](https://github.com/wundergraph/cosmo/issues/466)) ([033ff90](https://github.com/wundergraph/cosmo/commit/033ff9068716935a7d646adebcc0e2b776d0295d)) (@StarpTech)
* make execution plan cache & resolve concurrency configurable ([#469](https://github.com/wundergraph/cosmo/issues/469)) ([73edc64](https://github.com/wundergraph/cosmo/commit/73edc644070728c55772ef8714a72d1437095683)) (@jensneuse)

# [0.60.0](https://github.com/wundergraph/cosmo/compare/router@0.59.1...router@0.60.0) (2024-01-30)

### Features

* add federated graph id to attributes ([#464](https://github.com/wundergraph/cosmo/issues/464)) ([9c60bda](https://github.com/wundergraph/cosmo/commit/9c60bdab4a70bb603454c0dc38a335af9c445047)) (@thisisnithin)
* implement authorization directives ([#448](https://github.com/wundergraph/cosmo/issues/448)) ([181d89d](https://github.com/wundergraph/cosmo/commit/181d89d8e7dbf8eb23cddfa0b6c91c840a2986b0)) (@Aenimus)

## [0.59.1](https://github.com/wundergraph/cosmo/compare/router@0.59.0...router@0.59.1) (2024-01-29)

### Bug Fixes

* use graph id from token ([#463](https://github.com/wundergraph/cosmo/issues/463)) ([5582d00](https://github.com/wundergraph/cosmo/commit/5582d004c98eb20f62ecf2332b327c7959e5b64f)) (@thisisnithin)

# [0.59.0](https://github.com/wundergraph/cosmo/compare/router@0.58.0...router@0.59.0) (2024-01-26)

### Features

* namespaces ([#447](https://github.com/wundergraph/cosmo/issues/447)) ([bbe5258](https://github.com/wundergraph/cosmo/commit/bbe5258c5e764c52947f831d3a7f1a2f93c267d4)) (@thisisnithin)

# [0.58.0](https://github.com/wundergraph/cosmo/compare/router@0.57.0...router@0.58.0) (2024-01-26)

### Features

* produce spans for handler and engine work ([#456](https://github.com/wundergraph/cosmo/issues/456)) ([fd5ad67](https://github.com/wundergraph/cosmo/commit/fd5ad678c184c34e1f09ff2e89664c53894ae74c)) (@StarpTech)

# [0.57.0](https://github.com/wundergraph/cosmo/compare/router@0.56.1...router@0.57.0) (2024-01-24)

### Features

* allow custom playground path ([#452](https://github.com/wundergraph/cosmo/issues/452)) ([be250f5](https://github.com/wundergraph/cosmo/commit/be250f544a7345e4820c44eca34aa9558610cf6e)) (@StarpTech)

## [0.56.1](https://github.com/wundergraph/cosmo/compare/router@0.56.0...router@0.56.1) (2024-01-22)

**Note:** Version bump only for package router

# [0.56.0](https://github.com/wundergraph/cosmo/compare/router@0.55.0...router@0.56.0) (2024-01-22)

### Features

* **router:** aws lambda support ([#446](https://github.com/wundergraph/cosmo/issues/446)) ([9c7d386](https://github.com/wundergraph/cosmo/commit/9c7d38697ec5196326fb87d9cdadec5bc9b564f4)) (@StarpTech)

# [0.55.0](https://github.com/wundergraph/cosmo/compare/router@0.54.2...router@0.55.0) (2024-01-21)

### Features

* implement key resolvable false and implicit entities ([#445](https://github.com/wundergraph/cosmo/issues/445)) ([5685a43](https://github.com/wundergraph/cosmo/commit/5685a439c7a467e8f195948a5021a5511d91c870)) (@Aenimus)

## [0.54.2](https://github.com/wundergraph/cosmo/compare/router@0.54.1...router@0.54.2) (2024-01-16)

### Bug Fixes

* allow to start router without graph token but static config ([#433](https://github.com/wundergraph/cosmo/issues/433)) ([46a903c](https://github.com/wundergraph/cosmo/commit/46a903cbb9f37d18b9e59f979357ae6bf0762d5d)) (@StarpTech)

## [0.54.1](https://github.com/wundergraph/cosmo/compare/router@0.54.0...router@0.54.1) (2024-01-16)

### Bug Fixes

* poller interface for Windows ([8acf426](https://github.com/wundergraph/cosmo/commit/8acf4268a0447e64dce8892dd318f93c3e50aa2f)) (@StarpTech)
* skip healthchecks requests for tracing ([#431](https://github.com/wundergraph/cosmo/issues/431)) ([7871888](https://github.com/wundergraph/cosmo/commit/787188800cc0ac84c3f3c4ed80e2fef2fd2c9260)) (@StarpTech)

# [0.54.0](https://github.com/wundergraph/cosmo/compare/router@0.53.1...router@0.54.0) (2024-01-16)

### Features

* improve subscriptions ([#425](https://github.com/wundergraph/cosmo/issues/425)) ([2b60b72](https://github.com/wundergraph/cosmo/commit/2b60b727c044fa3095a4be312eaac256ef51af42)) (@jensneuse)

## [0.53.1](https://github.com/wundergraph/cosmo/compare/router@0.53.0...router@0.53.1) (2024-01-14)

### Bug Fixes

* disable epoll for windows to avoid CGO ([#421](https://github.com/wundergraph/cosmo/issues/421)) ([8bdadc6](https://github.com/wundergraph/cosmo/commit/8bdadc67188623e90d1e6a659f906119332dec3f)) (@StarpTech)

# [0.53.0](https://github.com/wundergraph/cosmo/compare/router@0.52.1...router@0.53.0) (2024-01-13)

### Features

* support custom trace propagation ([#420](https://github.com/wundergraph/cosmo/issues/420)) ([5a0a25e](https://github.com/wundergraph/cosmo/commit/5a0a25e2dd46761459bfa080aa6495a1a82e8549)) (@StarpTech)

## [0.52.1](https://github.com/wundergraph/cosmo/compare/router@0.52.0...router@0.52.1) (2024-01-12)

**Note:** Version bump only for package router

# [0.52.0](https://github.com/wundergraph/cosmo/compare/router@0.51.0...router@0.52.0) (2024-01-12)

### Bug Fixes

* **cdn:** return 404 when config does not exist ([#415](https://github.com/wundergraph/cosmo/issues/415)) ([63af53b](https://github.com/wundergraph/cosmo/commit/63af53b58ea9f3f77ffaf59847ba62d48e9a03fc)) (@StarpTech)

### Features

* provide router config over cdn ([#411](https://github.com/wundergraph/cosmo/issues/411)) ([f04ac84](https://github.com/wundergraph/cosmo/commit/f04ac84d2f6c155409f7db69e7646c04047e32b5)) (@JivusAyrus)

# [0.51.0](https://github.com/wundergraph/cosmo/compare/router@0.50.0...router@0.51.0) (2024-01-11)

### Features

* refactor ws impl and add test framework ([#406](https://github.com/wundergraph/cosmo/issues/406)) ([83c83b0](https://github.com/wundergraph/cosmo/commit/83c83b0e79ee353756edeb2d55c1b732d7345868)) (@jensneuse)

# [0.50.0](https://github.com/wundergraph/cosmo/compare/router@0.49.0...router@0.50.0) (2024-01-09)

### Features

* add support of interface objects ([#407](https://github.com/wundergraph/cosmo/issues/407)) ([3d7b0e1](https://github.com/wundergraph/cosmo/commit/3d7b0e1f55fd8087945923a8e4f5e7d66f6b559a)) (@Aenimus)

# [0.49.0](https://github.com/wundergraph/cosmo/compare/router@0.48.0...router@0.49.0) (2024-01-06)

### Features

* track subgraphs in metrics ([#405](https://github.com/wundergraph/cosmo/issues/405)) ([7b9f307](https://github.com/wundergraph/cosmo/commit/7b9f3074ea718d49135c5f46943002e37bef48e2)) (@StarpTech)

# [0.48.0](https://github.com/wundergraph/cosmo/compare/router@0.47.3...router@0.48.0) (2023-12-28)

### Features

* billing and limit refactoring ([#371](https://github.com/wundergraph/cosmo/issues/371)) ([0adfee1](https://github.com/wundergraph/cosmo/commit/0adfee146017a10c6e787a08723ef4d03ddf0f96)) (@Pagebakers)

## [0.47.3](https://github.com/wundergraph/cosmo/compare/router@0.47.2...router@0.47.3) (2023-12-27)

### Bug Fixes

* handle shutdown gracefully ([#393](https://github.com/wundergraph/cosmo/issues/393)) ([fbb0d3d](https://github.com/wundergraph/cosmo/commit/fbb0d3dda89829b7deb2a2abda2338803bd28d34)) (@StarpTech)

## [0.47.2](https://github.com/wundergraph/cosmo/compare/router@0.47.1...router@0.47.2) (2023-12-26)

**Note:** Version bump only for package router

## [0.47.1](https://github.com/wundergraph/cosmo/compare/router@0.47.0...router@0.47.1) (2023-12-21)

**Note:** Version bump only for package router

# [0.47.0](https://github.com/wundergraph/cosmo/compare/router@0.46.1...router@0.47.0) (2023-12-19)

### Bug Fixes

* playground icon and introspect on focus ([#380](https://github.com/wundergraph/cosmo/issues/380)) ([efea2b5](https://github.com/wundergraph/cosmo/commit/efea2b5a19e633835ef135a0c094c1c0398973d2)) (@thisisnithin)

### Features

* add NATS to the router ([#333](https://github.com/wundergraph/cosmo/issues/333)) ([9c8303b](https://github.com/wundergraph/cosmo/commit/9c8303ba6d49a3dea682ff598210b2891a8dd29c)) (@fiam)
* improve subgraph error handling ([#382](https://github.com/wundergraph/cosmo/issues/382)) ([bf2f70e](https://github.com/wundergraph/cosmo/commit/bf2f70e0e2d0560dd69cff10dc38e413aa7c93a3)) (@jensneuse)

## [0.46.1](https://github.com/wundergraph/cosmo/compare/router@0.46.0...router@0.46.1) (2023-12-17)

### Bug Fixes

* shutdown prom server on exit ([#378](https://github.com/wundergraph/cosmo/issues/378)) ([4ba6058](https://github.com/wundergraph/cosmo/commit/4ba605839cdf5ce7b719e204d47b128805440cfe)) (@StarpTech)

# [0.46.0](https://github.com/wundergraph/cosmo/compare/router@0.45.2...router@0.46.0) (2023-12-17)

### Features

* add singleflight to transport ([#372](https://github.com/wundergraph/cosmo/issues/372)) ([d74d3bf](https://github.com/wundergraph/cosmo/commit/d74d3bf89fdaf3231f4343eb6c77f926429746e9)) (@jensneuse)

## [0.45.2](https://github.com/wundergraph/cosmo/compare/router@0.45.1...router@0.45.2) (2023-12-13)

**Note:** Version bump only for package router

## [0.45.1](https://github.com/wundergraph/cosmo/compare/router@0.45.0...router@0.45.1) (2023-12-12)

**Note:** Version bump only for package router

# [0.45.0](https://github.com/wundergraph/cosmo/compare/router@0.44.1...router@0.45.0) (2023-12-12)

### Bug Fixes

* allow to host graphql playground and handler on the same path ([#354](https://github.com/wundergraph/cosmo/issues/354)) ([f8f01a2](https://github.com/wundergraph/cosmo/commit/f8f01a2b8f12ac18b27eb05032985a5daacc80df)) (@StarpTech)

### Features

* add rbac for subgraphs and federated graphs ([#351](https://github.com/wundergraph/cosmo/issues/351)) ([72e39bc](https://github.com/wundergraph/cosmo/commit/72e39bc1ff914831499c0625e443ab2ec0af135c)) (@JivusAyrus)

## [0.44.1](https://github.com/wundergraph/cosmo/compare/router@0.44.0...router@0.44.1) (2023-12-11)

**Note:** Version bump only for package router

# [0.44.0](https://github.com/wundergraph/cosmo/compare/router@0.43.3...router@0.44.0) (2023-12-09)

### Bug Fixes

* provide more specific error messages when operation planning fails ([#349](https://github.com/wundergraph/cosmo/issues/349)) ([4baa54c](https://github.com/wundergraph/cosmo/commit/4baa54c61b30a418689b1d0dfa668177df08f514)) (@fiam)
* race condition due to premature buffer reuse ([#350](https://github.com/wundergraph/cosmo/issues/350)) ([9ee2b43](https://github.com/wundergraph/cosmo/commit/9ee2b43b45b6a44e2deef01871d6a70e278af405)) (@fiam)

### Features

* add ability to pass a custom health checker ([#346](https://github.com/wundergraph/cosmo/issues/346)) ([29718a1](https://github.com/wundergraph/cosmo/commit/29718a1f75edd54af4b6cd43b5750f0222d031e4)) (@clayne11)

## [0.43.3](https://github.com/wundergraph/cosmo/compare/router@0.43.2...router@0.43.3) (2023-12-05)

**Note:** Version bump only for package router

## [0.43.2](https://github.com/wundergraph/cosmo/compare/router@0.43.1...router@0.43.2) (2023-12-01)

### Bug Fixes

* check equality of InputMetrics when aggregating same metrics ([#331](https://github.com/wundergraph/cosmo/issues/331)) ([0b4d3eb](https://github.com/wundergraph/cosmo/commit/0b4d3eba43e2e035f829eadcaf15ae5a424734c4)) (@StarpTech)

## [0.43.1](https://github.com/wundergraph/cosmo/compare/router@0.43.0...router@0.43.1) (2023-12-01)

**Note:** Version bump only for package router

# [0.43.0](https://github.com/wundergraph/cosmo/compare/router@0.42.3...router@0.43.0) (2023-12-01)

### Features

* improve support for extensions and initial payloads ([#324](https://github.com/wundergraph/cosmo/issues/324)) ([77a033f](https://github.com/wundergraph/cosmo/commit/77a033ffdce094b612ed69467a8cef6ee9f2fdc0)) (@fiam)
* persist ops from playground and view all client ops ([#323](https://github.com/wundergraph/cosmo/issues/323)) ([042d7db](https://github.com/wundergraph/cosmo/commit/042d7db00dbf2945a6be2b30e31d7851befc407b)) (@thisisnithin)

## [0.42.3](https://github.com/wundergraph/cosmo/compare/router@0.42.2...router@0.42.3) (2023-11-30)

### Bug Fixes

* image releases ([230fcef](https://github.com/wundergraph/cosmo/commit/230fcef52db8c36dd54ee8b5568eb627811d4fb1)) (@StarpTech)

## [0.42.2](https://github.com/wundergraph/cosmo/compare/router@0.42.1...router@0.42.2) (2023-11-30)

### Bug Fixes

* correct warning about supported router version ([86c3ca9](https://github.com/wundergraph/cosmo/commit/86c3ca9e4256e7c48b9c3a41af8e87a876fdecfb)) (@StarpTech)

## [0.42.1](https://github.com/wundergraph/cosmo/compare/router@0.42.0...router@0.42.1) (2023-11-30)

### Bug Fixes

* add X-WG-TOKEN optionally ([af22058](https://github.com/wundergraph/cosmo/commit/af220582167b4130ef50a6a2449957621835800e)) (@StarpTech)

# [0.42.0](https://github.com/wundergraph/cosmo/compare/router@0.41.0...router@0.42.0) (2023-11-30)

### Features

* add helm chart for CDN ([#307](https://github.com/wundergraph/cosmo/issues/307)) ([5e70d88](https://github.com/wundergraph/cosmo/commit/5e70d8834d2a676caee691a344ff1beb01689002)) (@fiam)
* register router on the controlplane ([#318](https://github.com/wundergraph/cosmo/issues/318)) ([10f86df](https://github.com/wundergraph/cosmo/commit/10f86dfebd80265d42015eaf3b9c15f941aef66b)) (@StarpTech)

# [0.41.0](https://github.com/wundergraph/cosmo/compare/router@0.40.1...router@0.41.0) (2023-11-29)

### Features

* add client extensions ([#319](https://github.com/wundergraph/cosmo/issues/319)) ([b9269f3](https://github.com/wundergraph/cosmo/commit/b9269f3342def04be2047b7bdc997d7d19890cbe)) (@jensneuse)

## [0.40.1](https://github.com/wundergraph/cosmo/compare/router@0.40.0...router@0.40.1) (2023-11-29)

**Note:** Version bump only for package router

# [0.40.0](https://github.com/wundergraph/cosmo/compare/router@0.39.0...router@0.40.0) (2023-11-29)

### Bug Fixes

* trace parsing and ui ([#310](https://github.com/wundergraph/cosmo/issues/310)) ([5eb9f67](https://github.com/wundergraph/cosmo/commit/5eb9f675a9294b26963bdd1c8ac8215448de0c4e)) (@thisisnithin)

### Features

* add variables validation ([#309](https://github.com/wundergraph/cosmo/issues/309)) ([2454df4](https://github.com/wundergraph/cosmo/commit/2454df40833e62499c113cf038ca63e82e37912e)) (@jensneuse)
* bundle custom graphiql in router ([#308](https://github.com/wundergraph/cosmo/issues/308)) ([de2779f](https://github.com/wundergraph/cosmo/commit/de2779faa48ae5fef23855091400292c0e118c7d)) (@thisisnithin)

# [0.39.0](https://github.com/wundergraph/cosmo/compare/router@0.38.1...router@0.39.0) (2023-11-27)

### Bug Fixes

* store JSONB as json, avoid custom log in automaxprocs ([#301](https://github.com/wundergraph/cosmo/issues/301)) ([c6a1486](https://github.com/wundergraph/cosmo/commit/c6a1486a69c383f247e0d3eb3723d883633b8780)) (@StarpTech)

### Features

* add support for enabling pprof handlers ([#298](https://github.com/wundergraph/cosmo/issues/298)) ([98988a1](https://github.com/wundergraph/cosmo/commit/98988a1e6962d15e59d660a31861fccbe9a86153)) (@fiam)

## [0.38.1](https://github.com/wundergraph/cosmo/compare/router@0.38.0...router@0.38.1) (2023-11-24)

**Note:** Version bump only for package router

# [0.38.0](https://github.com/wundergraph/cosmo/compare/router@0.37.0...router@0.38.0) (2023-11-24)

### Bug Fixes

* correctly implement normalization ([#292](https://github.com/wundergraph/cosmo/issues/292)) ([6433074](https://github.com/wundergraph/cosmo/commit/64330740f39ac15cce7d378f689ace1901babd0d)) (@jensneuse)

### Features

* improve art ([#293](https://github.com/wundergraph/cosmo/issues/293)) ([ee9dd5d](https://github.com/wundergraph/cosmo/commit/ee9dd5d2633b230e28ee714492b4f7f121a0423d)) (@jensneuse)

# [0.37.0](https://github.com/wundergraph/cosmo/compare/router@0.35.0...router@0.37.0) (2023-11-23)

### Features

* add support for persisted operations ([#249](https://github.com/wundergraph/cosmo/issues/249)) ([a9ad47f](https://github.com/wundergraph/cosmo/commit/a9ad47ff5cf7db6bccf774e168b1d1ce3ee7bcdd)) (@fiam)
* log traceID ([#284](https://github.com/wundergraph/cosmo/issues/284)) ([257de81](https://github.com/wundergraph/cosmo/commit/257de819a9735afddfc497d5b388dc3cb0e30bab)) (@fiam)

# [0.36.0](https://github.com/wundergraph/cosmo/compare/router@0.35.0...router@0.36.0) (2023-11-23)

### Features

* add support for persisted operations ([#249](https://github.com/wundergraph/cosmo/issues/249)) ([a9ad47f](https://github.com/wundergraph/cosmo/commit/a9ad47ff5cf7db6bccf774e168b1d1ce3ee7bcdd)) (@fiam)
* log traceID ([#284](https://github.com/wundergraph/cosmo/issues/284)) ([257de81](https://github.com/wundergraph/cosmo/commit/257de819a9735afddfc497d5b388dc3cb0e30bab)) (@fiam)

# [0.35.0](https://github.com/wundergraph/cosmo/compare/router@0.34.1...router@0.35.0) (2023-11-21)

### Features

* improve correctness of resolving ([#281](https://github.com/wundergraph/cosmo/issues/281)) ([0398fa1](https://github.com/wundergraph/cosmo/commit/0398fa18dbb631e31ec450fd3c16786eb8b4dfdc)) (@jensneuse)

## [0.34.1](https://github.com/wundergraph/cosmo/compare/router@0.34.0...router@0.34.1) (2023-11-20)

**Note:** Version bump only for package router

# [0.34.0](https://github.com/wundergraph/cosmo/compare/router@0.33.2...router@0.34.0) (2023-11-20)

### Features

* add tracing to request ([#263](https://github.com/wundergraph/cosmo/issues/263)) ([c43ee1c](https://github.com/wundergraph/cosmo/commit/c43ee1c56552ff0fe614634a81de89e3e95c1aa7)) (@jensneuse)
* auto set GOMAXPROCS to avoid CPU throttling on cont envs ([#276](https://github.com/wundergraph/cosmo/issues/276)) ([757a60a](https://github.com/wundergraph/cosmo/commit/757a60ab6d64d25e65a5ad9c5bb5ffe9edd5e649)) (@StarpTech)

## [0.33.2](https://github.com/wundergraph/cosmo/compare/router@0.33.1...router@0.33.2) (2023-11-20)

### Bug Fixes

* (router) refactor cmd/main to expose router instance ([#216](https://github.com/wundergraph/cosmo/issues/216)) ([e72172a](https://github.com/wundergraph/cosmo/commit/e72172a5186866b2f3d712294eea2fddae0719e2)) (@clayne11)

## [0.33.1](https://github.com/wundergraph/cosmo/compare/router@0.33.0...router@0.33.1) (2023-11-16)

### Bug Fixes

* parsing null variables ([#270](https://github.com/wundergraph/cosmo/issues/270)) ([568357c](https://github.com/wundergraph/cosmo/commit/568357c0832571c365ca990fe05e85ce30740c36)) (@devsergiy)

# [0.33.0](https://github.com/wundergraph/cosmo/compare/router@0.32.1...router@0.33.0) (2023-11-16)

### Features

* **router:** allow to start router without token and graph name when providing static config ([#264](https://github.com/wundergraph/cosmo/issues/264)) ([fa056b4](https://github.com/wundergraph/cosmo/commit/fa056b4bff1586676f156c0892bfd5cbe6a428d1)) (@StarpTech)

## [0.32.1](https://github.com/wundergraph/cosmo/compare/router@0.32.0...router@0.32.1) (2023-11-16)

**Note:** Version bump only for package router

# [0.32.0](https://github.com/wundergraph/cosmo/compare/router@0.31.0...router@0.32.0) (2023-11-15)

### Features

* consider input and argument usage for breaking change detection ([#255](https://github.com/wundergraph/cosmo/issues/255)) ([e10ac40](https://github.com/wundergraph/cosmo/commit/e10ac401f543f5540b5ada8f80533ddfbd0bc728)) (@jensneuse)

# [0.31.0](https://github.com/wundergraph/cosmo/compare/router@0.30.0...router@0.31.0) (2023-11-08)

### Features

* add support for header forwarding with websocket requests ([#212](https://github.com/wundergraph/cosmo/issues/212)) ([5bc07dc](https://github.com/wundergraph/cosmo/commit/5bc07dc368ea2689f79bf9f7af971b8468df619a)) (@fiam)

# [0.30.0](https://github.com/wundergraph/cosmo/compare/router@0.29.0...router@0.30.0) (2023-11-07)

### Features

* automatically translate failed requests to localhost to docker.host.internal ([#224](https://github.com/wundergraph/cosmo/issues/224)) ([936006d](https://github.com/wundergraph/cosmo/commit/936006d8b91eee310768c69dfc9fde5e4c286108)) (@fiam)
* upgrade minimum required Go version to 1.21 ([#239](https://github.com/wundergraph/cosmo/issues/239)) ([d7fe7da](https://github.com/wundergraph/cosmo/commit/d7fe7daf78fceaf3fdb1679bfa3addef8cdfd67a)) (@fiam)

# [0.29.0](https://github.com/wundergraph/cosmo/compare/router@0.28.2...router@0.29.0) (2023-11-06)

### Features

* **controlplane:** avoid downloading config for latest check ([#236](https://github.com/wundergraph/cosmo/issues/236)) ([1929554](https://github.com/wundergraph/cosmo/commit/1929554e158548972cddacd3a59bca81133434a1)) (@StarpTech)

## [0.28.2](https://github.com/wundergraph/cosmo/compare/router@0.28.1...router@0.28.2) (2023-11-06)

### Bug Fixes

* ensure proper graphql error response when passing nil error ([#233](https://github.com/wundergraph/cosmo/issues/233)) ([459f94d](https://github.com/wundergraph/cosmo/commit/459f94df65ca8a07447c29142b0f7f16473b708e)) (@StarpTech)
* resolve issue single entity result in root ([#237](https://github.com/wundergraph/cosmo/issues/237)) ([7902a55](https://github.com/wundergraph/cosmo/commit/7902a55722748e684bc63668b04d768427223d81)) (@jensneuse)

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
