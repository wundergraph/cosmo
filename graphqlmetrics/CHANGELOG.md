# Change Log
Binaries are attached to the github release otherwise all images can be found [here](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.36.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.35.0...graphqlmetrics@0.36.0) (2025-09-06)

### Features

* upgrade all components to go 1.25 ([#2187](https://github.com/wundergraph/cosmo/issues/2187)) ([49c35ed](https://github.com/wundergraph/cosmo/commit/49c35ede5ab5873ee163815a047797429a63e3d1)) (@miklosbarabas)

# [0.35.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.34.1...graphqlmetrics@0.35.0) (2025-06-13)

### Features

* add org and graph ID to gql_metrics_operations table ([#1582](https://github.com/wundergraph/cosmo/issues/1582)) ([94879de](https://github.com/wundergraph/cosmo/commit/94879de0713cb3e7d0b941c4bad1ed938acbaec8)) (@JivusAyrus)

## [0.34.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.34.0...graphqlmetrics@0.34.1) (2025-06-06)

### Bug Fixes

* golang/x/net vulnerability fixes (including engine upgrade which also has the net fix) ([#1932](https://github.com/wundergraph/cosmo/issues/1932)) ([69a7468](https://github.com/wundergraph/cosmo/commit/69a74688088f1feb2bc4a1b34500cd6b7cd18482)) (@SkArchon)
* resolve security vulnerabilities ([#1938](https://github.com/wundergraph/cosmo/issues/1938)) ([35e6c73](https://github.com/wundergraph/cosmo/commit/35e6c7374cd40f3e89655e08ec0671f2b30bc00c)) (@SkArchon)

# [0.34.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.33.2...graphqlmetrics@0.34.0) (2025-04-15)

### Features

* implement proposals in cosmo ([#1727](https://github.com/wundergraph/cosmo/issues/1727)) ([1d36747](https://github.com/wundergraph/cosmo/commit/1d36747dda3f2f3c491092f0f02cefa22fc9c131)) (@JivusAyrus)

## [0.33.2](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.33.1...graphqlmetrics@0.33.2) (2025-04-15)

**Note:** Version bump only for package graphqlmetrics

## [0.33.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.33.0...graphqlmetrics@0.33.1) (2025-03-25)

### Bug Fixes

* updated go jwt dependency to fix vulnerability ([#1714](https://github.com/wundergraph/cosmo/issues/1714)) ([247b3cf](https://github.com/wundergraph/cosmo/commit/247b3cf5ee65a12910b68aca363e5ad3ec2a8be5)) (@SkArchon)

# [0.33.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.32.3...graphqlmetrics@0.33.0) (2025-02-17)

### Features

* add composition versioning ([#1575](https://github.com/wundergraph/cosmo/issues/1575)) ([ee32cbb](https://github.com/wundergraph/cosmo/commit/ee32cbb3dbe7c46fa984920bbd95e4a00d01c9c3)) (@Aenimus)

## [0.32.3](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.32.2...graphqlmetrics@0.32.3) (2025-02-05)

**Note:** Version bump only for package graphqlmetrics

## [0.32.2](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.32.1...graphqlmetrics@0.32.2) (2025-01-29)

**Note:** Version bump only for package graphqlmetrics

## [0.32.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.32.0...graphqlmetrics@0.32.1) (2025-01-19)

### Bug Fixes

* **cache operation:** swallow cache errors and other improvements ([#1515](https://github.com/wundergraph/cosmo/issues/1515)) ([d959e2c](https://github.com/wundergraph/cosmo/commit/d959e2c9fb492cc7c73d89f61c31f3bad2ac5706)) (@StarpTech)

# [0.32.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.31.1...graphqlmetrics@0.32.0) (2025-01-17)

### Features

* cache warmer ([#1501](https://github.com/wundergraph/cosmo/issues/1501)) ([948edd2](https://github.com/wundergraph/cosmo/commit/948edd23e6d0ee968c91edd1a9e9943c3405ac2d)) (@JivusAyrus)

## [0.31.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.31.0...graphqlmetrics@0.31.1) (2025-01-06)

### Bug Fixes

* add regex validation to graph names and routing urls ([#1450](https://github.com/wundergraph/cosmo/issues/1450)) ([e5b1c8f](https://github.com/wundergraph/cosmo/commit/e5b1c8fb33a41fc808067bb6495a43f74b60b314)) (@JivusAyrus)

# [0.31.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.30.3...graphqlmetrics@0.31.0) (2024-12-21)

### Features

* upgrade go to 1.23 ([#1473](https://github.com/wundergraph/cosmo/issues/1473)) ([4c29d2d](https://github.com/wundergraph/cosmo/commit/4c29d2d358c2b716a33e35505b080b9be2e1fce3)) (@StarpTech)

## [0.30.3](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.30.2...graphqlmetrics@0.30.3) (2024-12-18)

**Note:** Version bump only for package graphqlmetrics

## [0.30.2](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.30.1...graphqlmetrics@0.30.2) (2024-12-03)

### Bug Fixes

* ignore internal cost for ristretto caches ([#1413](https://github.com/wundergraph/cosmo/issues/1413)) ([94c9623](https://github.com/wundergraph/cosmo/commit/94c9623b3b10449de2075dff149640809cafb52a)) (@Noroth)

## [0.30.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.30.0...graphqlmetrics@0.30.1) (2024-11-18)

**Note:** Version bump only for package graphqlmetrics

# [0.30.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.29.4...graphqlmetrics@0.30.0) (2024-11-15)

### Features

* **graphqlmetrics:** allow measurement of total request count per day ([#1369](https://github.com/wundergraph/cosmo/issues/1369)) ([d29b462](https://github.com/wundergraph/cosmo/commit/d29b462a863202ff8fe01d231b0a7c427c981680)) (@Noroth)

## [0.29.4](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.29.3...graphqlmetrics@0.29.4) (2024-11-12)

### Performance Improvements

* **graphqlmetrics:** reduce allocated memory ([#1356](https://github.com/wundergraph/cosmo/issues/1356)) ([ff4874b](https://github.com/wundergraph/cosmo/commit/ff4874b3346b0398f46c96b0244989ace7b2c1ba)) (@Noroth)

## [0.29.3](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.29.2...graphqlmetrics@0.29.3) (2024-11-08)

**Note:** Version bump only for package graphqlmetrics

## [0.29.2](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.29.1...graphqlmetrics@0.29.2) (2024-11-08)

### Bug Fixes

* **graphqlmetrics:** improve batch preparation ([#1352](https://github.com/wundergraph/cosmo/issues/1352)) ([9178dd7](https://github.com/wundergraph/cosmo/commit/9178dd74ecfb48f727da01cdfc4f2b9e270f7916)) (@Noroth)

## [0.29.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.29.0...graphqlmetrics@0.29.1) (2024-11-07)

### Bug Fixes

* improve batch processing ([#1348](https://github.com/wundergraph/cosmo/issues/1348)) ([8ddbff4](https://github.com/wundergraph/cosmo/commit/8ddbff4de4347ead5a780e2909e4e030b0e0086f)) (@StarpTech)

# [0.29.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.28.1...graphqlmetrics@0.29.0) (2024-11-07)

### Features

* **graphqlmetrics:** implement more efficient batching of clickhouse entries ([#1344](https://github.com/wundergraph/cosmo/issues/1344)) ([5f4db6a](https://github.com/wundergraph/cosmo/commit/5f4db6a54d1d744af9dc193951a7adb7260fa4a1)) (@Noroth)

## [0.28.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.28.0...graphqlmetrics@0.28.1) (2024-11-05)

**Note:** Version bump only for package graphqlmetrics

# [0.28.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.27.0...graphqlmetrics@0.28.0) (2024-10-25)

### Features

* add origin subgraph request epoll support ([#1284](https://github.com/wundergraph/cosmo/issues/1284)) ([4fe8146](https://github.com/wundergraph/cosmo/commit/4fe81461a43e45dbd3bae482976fec8127d3d982)) (@jensneuse)

# [0.27.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.26.0...graphqlmetrics@0.27.0) (2024-10-22)

### Features

* add traceId to logs ([#1279](https://github.com/wundergraph/cosmo/issues/1279)) ([025da28](https://github.com/wundergraph/cosmo/commit/025da2888ea95dbb2de581d6affda76fdc74332a)) (@JivusAyrus)

# [0.26.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.25.0...graphqlmetrics@0.26.0) (2024-10-17)

### Features

* custom metric attributes ([#1267](https://github.com/wundergraph/cosmo/issues/1267)) ([f6a4224](https://github.com/wundergraph/cosmo/commit/f6a4224a2370e8eb6e36598a22f60a3eee83f055)) (@StarpTech)

# [0.25.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.24.0...graphqlmetrics@0.25.0) (2024-10-09)

### Features

* add indirect interface fields to schema usage reporting ([#1235](https://github.com/wundergraph/cosmo/issues/1235)) ([1c62c14](https://github.com/wundergraph/cosmo/commit/1c62c14f9a9f11a6fbbebf5a3fbc4d85f304285e)) (@jensneuse)

# [0.24.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.23.1...graphqlmetrics@0.24.0) (2024-09-23)

### Features

* add apollo compatibility mode with support for valueCompletion ([#1205](https://github.com/wundergraph/cosmo/issues/1205)) ([18b1ef0](https://github.com/wundergraph/cosmo/commit/18b1ef01b12945d2f3acc80ea9548a17f9effa21)) (@jensneuse)

## [0.23.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.23.0...graphqlmetrics@0.23.1) (2024-09-20)

### Bug Fixes

* handle empty batch of metrics ([#1200](https://github.com/wundergraph/cosmo/issues/1200)) ([4af9beb](https://github.com/wundergraph/cosmo/commit/4af9beb65cfb2f16b24d199fc6f603d083719001)) (@StarpTech)

# [0.23.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.22.1...graphqlmetrics@0.23.0) (2024-09-19)

### Features

* add graph pruning ([#1133](https://github.com/wundergraph/cosmo/issues/1133)) ([b5718cd](https://github.com/wundergraph/cosmo/commit/b5718cd66bc7f0d14cb16b3d0a6d395e846968e4)) (@JivusAyrus)

## [0.22.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.22.0...graphqlmetrics@0.22.1) (2024-09-18)

### Bug Fixes

* **collector:** dont process empty schema usage metrics ([#1191](https://github.com/wundergraph/cosmo/issues/1191)) ([73b5d67](https://github.com/wundergraph/cosmo/commit/73b5d67769875bc77303f0e5a96293b72013138e)) (@StarpTech)

# [0.22.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.21.1...graphqlmetrics@0.22.0) (2024-08-19)

### Features

* implement more efficient aggregation of schema usage metrics with caching ([#1095](https://github.com/wundergraph/cosmo/issues/1095)) ([a40c9d8](https://github.com/wundergraph/cosmo/commit/a40c9d83e8434bfe1a8338bd8892b110022c14ad)) (@jensneuse)

## [0.21.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.21.0...graphqlmetrics@0.21.1) (2024-08-01)

### Bug Fixes

* wrong otelhttp used ([#996](https://github.com/wundergraph/cosmo/issues/996)) ([6b322f6](https://github.com/wundergraph/cosmo/commit/6b322f62359da48336c7c9f4c07eac750db93907)) (@StarpTech)

# [0.21.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.20.3...graphqlmetrics@0.21.0) (2024-08-01)

### Features

* **graphqlmetrics:** enable prometheus metrics ([#963](https://github.com/wundergraph/cosmo/issues/963)) ([48f54fe](https://github.com/wundergraph/cosmo/commit/48f54fed6444fd6ffc25a86fe45225b717fabca4)) (@AndreasZeissner)

## [0.20.3](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.20.2...graphqlmetrics@0.20.3) (2024-07-30)

### Bug Fixes

* input coercion for nested values ([#981](https://github.com/wundergraph/cosmo/issues/981)) ([5494e5f](https://github.com/wundergraph/cosmo/commit/5494e5f3075db7795c100c927001a4baae212c68)) (@jensneuse)

## [0.20.2](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.20.1...graphqlmetrics@0.20.2) (2024-07-16)

**Note:** Version bump only for package graphqlmetrics

## [0.20.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.20.0...graphqlmetrics@0.20.1) (2024-07-04)

**Note:** Version bump only for package graphqlmetrics

# [0.20.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.19.0...graphqlmetrics@0.20.0) (2024-07-03)

### Features

* feature flags ([#853](https://github.com/wundergraph/cosmo/issues/853)) ([5461bb5](https://github.com/wundergraph/cosmo/commit/5461bb5a529decd51a1b22be0a5301936b8ad392)) (@JivusAyrus)

# [0.19.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.18.0...graphqlmetrics@0.19.0) (2024-06-26)

### Features

* support file upload in router ([#772](https://github.com/wundergraph/cosmo/issues/772)) ([d1cbc11](https://github.com/wundergraph/cosmo/commit/d1cbc11deedbdefad949a3aa5a1b753da4682145)) (@pedraumcosta)

# [0.18.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.17.1...graphqlmetrics@0.18.0) (2024-05-31)

### Features

* support multiple/static NATS EDFS arg templates ([#841](https://github.com/wundergraph/cosmo/issues/841)) ([2c75870](https://github.com/wundergraph/cosmo/commit/2c75870cc65d5a43e864f69e39f202170257f9df)) (@Aenimus)

## [0.17.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.17.0...graphqlmetrics@0.17.1) (2024-05-29)

**Note:** Version bump only for package graphqlmetrics

# [0.17.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.16.0...graphqlmetrics@0.17.0) (2024-05-21)

### Features

* add support for websocket subprotocol ([#776](https://github.com/wundergraph/cosmo/issues/776)) ([e35aa26](https://github.com/wundergraph/cosmo/commit/e35aa262227b29f09ddfdd1ce361c010b769b2da)) (@JivusAyrus)

# [0.16.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.15.3...graphqlmetrics@0.16.0) (2024-05-14)

### Features

* refactor edfs and add kafka support ([#770](https://github.com/wundergraph/cosmo/issues/770)) ([d659067](https://github.com/wundergraph/cosmo/commit/d659067fd1d094621788f42bac6d121b0831ebb7)) (@StarpTech)

## [0.15.3](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.15.2...graphqlmetrics@0.15.3) (2024-04-12)

**Note:** Version bump only for package graphqlmetrics

## [0.15.2](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.15.1...graphqlmetrics@0.15.2) (2024-04-09)

**Note:** Version bump only for package graphqlmetrics

## [0.15.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.15.0...graphqlmetrics@0.15.1) (2024-04-08)

### Bug Fixes

* provide default subscription protocol for composition-go ([#702](https://github.com/wundergraph/cosmo/issues/702)) ([53140ea](https://github.com/wundergraph/cosmo/commit/53140eabcc960bd95626837da308c86674aeb8a4)) (@Aenimus)

# [0.15.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.14.0...graphqlmetrics@0.15.0) (2024-03-24)

### Features

* multi platform docker builds ([#665](https://github.com/wundergraph/cosmo/issues/665)) ([4c24d70](https://github.com/wundergraph/cosmo/commit/4c24d7075bd48cd946a1037bffc0c4fcaef74289)) (@StarpTech)

# [0.14.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.13.0...graphqlmetrics@0.14.0) (2024-03-14)

### Features

* router config signature validation through custom admission webhooks ([#628](https://github.com/wundergraph/cosmo/issues/628)) ([384fd7e](https://github.com/wundergraph/cosmo/commit/384fd7e3372479e96fccc4fc771dc4e9f9c84754)) (@StarpTech)

# [0.13.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.12.1...graphqlmetrics@0.13.0) (2024-02-17)

### Features

* use json schema to validate and document router config ([#545](https://github.com/wundergraph/cosmo/issues/545)) ([ec700ba](https://github.com/wundergraph/cosmo/commit/ec700bae0224d3d0180b8d56800f48c9002dcee5)) (@StarpTech)

## [0.12.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.12.0...graphqlmetrics@0.12.1) (2024-02-16)

**Note:** Version bump only for package graphqlmetrics

# [0.12.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.11.0...graphqlmetrics@0.12.0) (2024-02-13)

### Features

* router fleet management ([#515](https://github.com/wundergraph/cosmo/issues/515)) ([7f0deae](https://github.com/wundergraph/cosmo/commit/7f0deae98a2f58bd46927bdb2be8d615613b908f)) (@StarpTech)

# [0.11.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.10.0...graphqlmetrics@0.11.0) (2024-01-22)

### Features

* **router:** aws lambda support ([#446](https://github.com/wundergraph/cosmo/issues/446)) ([9c7d386](https://github.com/wundergraph/cosmo/commit/9c7d38697ec5196326fb87d9cdadec5bc9b564f4)) (@StarpTech)

# [0.10.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.9.0...graphqlmetrics@0.10.0) (2024-01-09)

### Features

* add support of interface objects ([#407](https://github.com/wundergraph/cosmo/issues/407)) ([3d7b0e1](https://github.com/wundergraph/cosmo/commit/3d7b0e1f55fd8087945923a8e4f5e7d66f6b559a)) (@Aenimus)

# [0.9.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.8.2...graphqlmetrics@0.9.0) (2023-12-28)

### Features

* billing and limit refactoring ([#371](https://github.com/wundergraph/cosmo/issues/371)) ([0adfee1](https://github.com/wundergraph/cosmo/commit/0adfee146017a10c6e787a08723ef4d03ddf0f96)) (@Pagebakers)

## [0.8.2](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.8.1...graphqlmetrics@0.8.2) (2023-12-21)

**Note:** Version bump only for package graphqlmetrics

## [0.8.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.8.0...graphqlmetrics@0.8.1) (2023-12-12)

**Note:** Version bump only for package graphqlmetrics

# [0.8.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.7.1...graphqlmetrics@0.8.0) (2023-12-12)

### Features

* add rbac for subgraphs and federated graphs ([#351](https://github.com/wundergraph/cosmo/issues/351)) ([72e39bc](https://github.com/wundergraph/cosmo/commit/72e39bc1ff914831499c0625e443ab2ec0af135c)) (@JivusAyrus)

## [0.7.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.7.0...graphqlmetrics@0.7.1) (2023-12-11)

**Note:** Version bump only for package graphqlmetrics

# [0.7.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.6.1...graphqlmetrics@0.7.0) (2023-12-09)

### Features

* extend graphqlmetrics chart ([#344](https://github.com/wundergraph/cosmo/issues/344)) ([bad337d](https://github.com/wundergraph/cosmo/commit/bad337d0f1fafab5772910b5cce97cab03992c38)) (@StarpTech)

## [0.6.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.6.0...graphqlmetrics@0.6.1) (2023-11-30)

### Bug Fixes

* image releases ([230fcef](https://github.com/wundergraph/cosmo/commit/230fcef52db8c36dd54ee8b5568eb627811d4fb1)) (@StarpTech)

# [0.6.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.5.1...graphqlmetrics@0.6.0) (2023-11-20)

### Features

* auto set GOMAXPROCS to avoid CPU throttling on cont envs ([#276](https://github.com/wundergraph/cosmo/issues/276)) ([757a60a](https://github.com/wundergraph/cosmo/commit/757a60ab6d64d25e65a5ad9c5bb5ffe9edd5e649)) (@StarpTech)

## [0.5.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.5.0...graphqlmetrics@0.5.1) (2023-11-20)

### Bug Fixes

* move to bitnami charts and exit 1 on migration issues ([#275](https://github.com/wundergraph/cosmo/issues/275)) ([90d9d93](https://github.com/wundergraph/cosmo/commit/90d9d938cefdc78a9f34d69387f306b4d691c7f0)) (@StarpTech)

# [0.5.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.4.0...graphqlmetrics@0.5.0) (2023-11-15)

### Features

* consider input and argument usage for breaking change detection ([#255](https://github.com/wundergraph/cosmo/issues/255)) ([e10ac40](https://github.com/wundergraph/cosmo/commit/e10ac401f543f5540b5ada8f80533ddfbd0bc728)) (@jensneuse)

# [0.4.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.3.0...graphqlmetrics@0.4.0) (2023-11-07)

### Features

* upgrade minimum required Go version to 1.21 ([#239](https://github.com/wundergraph/cosmo/issues/239)) ([d7fe7da](https://github.com/wundergraph/cosmo/commit/d7fe7daf78fceaf3fdb1679bfa3addef8cdfd67a)) (@fiam)

# [0.3.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.2.0...graphqlmetrics@0.3.0) (2023-11-03)

### Features

* provide debug mode in gql collector ([#229](https://github.com/wundergraph/cosmo/issues/229)) ([136fe36](https://github.com/wundergraph/cosmo/commit/136fe36cd8c882b925b097ff19cea040a89248f4)) (@StarpTech)
* provide debug mode in gql collector ([#230](https://github.com/wundergraph/cosmo/issues/230)) ([c1903d0](https://github.com/wundergraph/cosmo/commit/c1903d027b7ea7fb1e695e58641ed9ad24b640f8)) (@StarpTech)

# [0.2.0](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.1.2...graphqlmetrics@0.2.0) (2023-11-03)

### Features

* operation checks (breaking change detection) ([#214](https://github.com/wundergraph/cosmo/issues/214)) ([0935413](https://github.com/wundergraph/cosmo/commit/093541305866327c5c44637603621e4a8053640d)) (@StarpTech)

## [0.1.2](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.1.1...graphqlmetrics@0.1.2) (2023-10-26)

**Note:** Version bump only for package graphqlmetrics

## [0.1.1](https://github.com/wundergraph/cosmo/compare/graphqlmetrics@0.1.0...graphqlmetrics@0.1.1) (2023-10-25)

### Bug Fixes

* **graphqlmetrics:** pass parsed DSN default options ([81f51ea](https://github.com/wundergraph/cosmo/commit/81f51ea2a81001dbdab9f0502a28fba0810616ab)) (@StarpTech)

# 0.1.0 (2023-10-25)

### Features

* schema field level usage analytics ([#174](https://github.com/wundergraph/cosmo/issues/174)) ([4f257a7](https://github.com/wundergraph/cosmo/commit/4f257a71984e991be2304b09a083c69da65200d2)) (@StarpTech)
