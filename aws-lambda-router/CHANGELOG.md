# Change Log
Binaries are attached to the github release otherwise all images can be found [here](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.39.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.38.4...aws-lambda-router@0.39.0) (2025-09-06)

### Features

* upgrade all components to go 1.25 ([#2187](https://github.com/wundergraph/cosmo/issues/2187)) ([49c35ed](https://github.com/wundergraph/cosmo/commit/49c35ede5ab5873ee163815a047797429a63e3d1)) (@miklosbarabas)

## [0.38.4](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.38.3...aws-lambda-router@0.38.4) (2025-07-16)

### Bug Fixes

* update router go-chi version ([#2054](https://github.com/wundergraph/cosmo/issues/2054)) ([645fc12](https://github.com/wundergraph/cosmo/commit/645fc12fa5ce18b4a112400c367209d073a077db)) (@SkArchon)

## [0.38.3](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.38.2...aws-lambda-router@0.38.3) (2025-06-06)

### Bug Fixes

* golang/x/net vulnerability fixes (including engine upgrade which also has the net fix) ([#1932](https://github.com/wundergraph/cosmo/issues/1932)) ([69a7468](https://github.com/wundergraph/cosmo/commit/69a74688088f1feb2bc4a1b34500cd6b7cd18482)) (@SkArchon)

## [0.38.2](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.38.1...aws-lambda-router@0.38.2) (2025-04-15)

**Note:** Version bump only for package aws-lambda-router

## [0.38.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.38.0...aws-lambda-router@0.38.1) (2025-04-02)

**Note:** Version bump only for package aws-lambda-router

# [0.38.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.37.7...aws-lambda-router@0.38.0) (2024-12-21)

### Features

* upgrade go to 1.23 ([#1473](https://github.com/wundergraph/cosmo/issues/1473)) ([4c29d2d](https://github.com/wundergraph/cosmo/commit/4c29d2d358c2b716a33e35505b080b9be2e1fce3)) (@StarpTech)

## [0.37.7](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.37.6...aws-lambda-router@0.37.7) (2024-12-18)

**Note:** Version bump only for package aws-lambda-router

## [0.37.6](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.37.5...aws-lambda-router@0.37.6) (2024-11-16)

### Bug Fixes

* **tests:** deadlock on unsubscribe when epoll disabled ([#1380](https://github.com/wundergraph/cosmo/issues/1380)) ([337a60f](https://github.com/wundergraph/cosmo/commit/337a60f15577b373ca67a83497304d53fe19f55d)) (@StarpTech)

## [0.37.5](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.37.4...aws-lambda-router@0.37.5) (2024-11-14)

### Bug Fixes

* fix merging of response nodes of enum type ([#1373](https://github.com/wundergraph/cosmo/issues/1373)) ([f3927e3](https://github.com/wundergraph/cosmo/commit/f3927e3cfc382bff9beff0a7868b444db213b9d6)) (@devsergiy)

## [0.37.4](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.37.3...aws-lambda-router@0.37.4) (2024-11-12)

### Bug Fixes

* variables normalization for the anonymous operations ([#1365](https://github.com/wundergraph/cosmo/issues/1365)) ([0b8ff06](https://github.com/wundergraph/cosmo/commit/0b8ff06592954bef2329fa69a660c60e55e4eb3d)) (@devsergiy)

## [0.37.3](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.37.2...aws-lambda-router@0.37.3) (2024-11-12)

**Note:** Version bump only for package aws-lambda-router

## [0.37.2](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.37.1...aws-lambda-router@0.37.2) (2024-11-08)

### Bug Fixes

* json parsing and input templates rendering ([#1350](https://github.com/wundergraph/cosmo/issues/1350)) ([578a408](https://github.com/wundergraph/cosmo/commit/578a4085862b3149dbbfb10362aff118c62dfff2)) (@jensneuse)

## [0.37.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.37.0...aws-lambda-router@0.37.1) (2024-11-07)

**Note:** Version bump only for package aws-lambda-router

# [0.37.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.36.1...aws-lambda-router@0.37.0) (2024-11-05)

### Features

* context handling performance & memory improvements ([#1336](https://github.com/wundergraph/cosmo/issues/1336)) ([1aed39a](https://github.com/wundergraph/cosmo/commit/1aed39a99d604595ca4fef711a45ef0b059f77a5)) (@jensneuse)

## [0.36.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.36.0...aws-lambda-router@0.36.1) (2024-11-04)

**Note:** Version bump only for package aws-lambda-router

# [0.36.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.35.0...aws-lambda-router@0.36.0) (2024-10-29)

### Features

* extend apollo compatible error support ([#1311](https://github.com/wundergraph/cosmo/issues/1311)) ([d4d727e](https://github.com/wundergraph/cosmo/commit/d4d727e1c98f92eaa2103ca2356537e3a63eeff2)) (@Aenimus)

# [0.35.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.34.2...aws-lambda-router@0.35.0) (2024-10-28)

### Features

* upgrade go tools to support lock free epoll conn handling for ws origin requests ([#1316](https://github.com/wundergraph/cosmo/issues/1316)) ([f3f23d6](https://github.com/wundergraph/cosmo/commit/f3f23d6686a241a38700ff9b0ce8c5fe6a41582f)) (@jensneuse)

## [0.34.2](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.34.1...aws-lambda-router@0.34.2) (2024-10-27)

**Note:** Version bump only for package aws-lambda-router

## [0.34.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.34.0...aws-lambda-router@0.34.1) (2024-10-25)

**Note:** Version bump only for package aws-lambda-router

# [0.34.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.33.1...aws-lambda-router@0.34.0) (2024-10-25)

### Features

* add origin subgraph request epoll support ([#1284](https://github.com/wundergraph/cosmo/issues/1284)) ([4fe8146](https://github.com/wundergraph/cosmo/commit/4fe81461a43e45dbd3bae482976fec8127d3d982)) (@jensneuse)

## [0.33.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.33.0...aws-lambda-router@0.33.1) (2024-10-24)

### Bug Fixes

* value completion typename, planner shared nodes selections ([#1306](https://github.com/wundergraph/cosmo/issues/1306)) ([b5929bf](https://github.com/wundergraph/cosmo/commit/b5929bfcd263e835efae617d3ca64691c44c7ff9)) (@devsergiy)

# [0.33.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.32.0...aws-lambda-router@0.33.0) (2024-10-21)

### Features

* include subgraph name in ART ([#1290](https://github.com/wundergraph/cosmo/issues/1290)) ([2acfc30](https://github.com/wundergraph/cosmo/commit/2acfc300a618b4fe8392df0633c6dd6c5bbe393a)) (@StarpTech)

# [0.32.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.31.0...aws-lambda-router@0.32.0) (2024-10-18)

### Features

* improve planning time ([#1287](https://github.com/wundergraph/cosmo/issues/1287)) ([c4ff4dd](https://github.com/wundergraph/cosmo/commit/c4ff4dda5bce0cf12429554d458304b92525e800)) (@devsergiy)

# [0.31.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.30.2...aws-lambda-router@0.31.0) (2024-10-17)

### Features

* **tests:** add service and code when extensions is null or empty ([#1283](https://github.com/wundergraph/cosmo/issues/1283)) ([b220e81](https://github.com/wundergraph/cosmo/commit/b220e81148829c50dd7f710a2098dffe0260dc61)) (@StarpTech)

## [0.30.2](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.30.1...aws-lambda-router@0.30.2) (2024-10-16)

### Bug Fixes

* provides edge cases ([#1275](https://github.com/wundergraph/cosmo/issues/1275)) ([a5020b3](https://github.com/wundergraph/cosmo/commit/a5020b3f547306fc2a7e94855caeb9daf3732e78)) (@devsergiy)

## [0.30.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.30.0...aws-lambda-router@0.30.1) (2024-10-11)

### Bug Fixes

* handling external fields ([#1266](https://github.com/wundergraph/cosmo/issues/1266)) ([fff7225](https://github.com/wundergraph/cosmo/commit/fff72258dbb453bcc94558b3440fe72d797e6d0a)) (@devsergiy)

# [0.30.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.29.0...aws-lambda-router@0.30.0) (2024-10-11)

### Features

* add suppress fetch errors option to apollo compatibility flags ([#1258](https://github.com/wundergraph/cosmo/issues/1258)) ([a4d1adb](https://github.com/wundergraph/cosmo/commit/a4d1adba01e587b72cb5180eb3241f8943d34014)) (@JivusAyrus)

# [0.29.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.28.0...aws-lambda-router@0.29.0) (2024-10-10)

### Features

* create subsciption over multipart ([#1227](https://github.com/wundergraph/cosmo/issues/1227)) ([3bbc8d9](https://github.com/wundergraph/cosmo/commit/3bbc8d9c9e48cd3f37214214ca55954a1e97b00a)) (@df-wg)

# [0.28.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.27.1...aws-lambda-router@0.28.0) (2024-10-09)

### Features

* add indirect interface fields to schema usage reporting ([#1235](https://github.com/wundergraph/cosmo/issues/1235)) ([1c62c14](https://github.com/wundergraph/cosmo/commit/1c62c14f9a9f11a6fbbebf5a3fbc4d85f304285e)) (@jensneuse)

## [0.27.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.27.0...aws-lambda-router@0.27.1) (2024-10-07)

**Note:** Version bump only for package aws-lambda-router

# [0.27.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.26.1...aws-lambda-router@0.27.0) (2024-10-07)

### Features

* allow specified fields in subgraph errors ([#1248](https://github.com/wundergraph/cosmo/issues/1248)) ([72c770d](https://github.com/wundergraph/cosmo/commit/72c770d1d4d795f70586dfaa1a0ffab2943638a4)) (@thisisnithin)

## [0.26.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.26.0...aws-lambda-router@0.26.1) (2024-10-03)

### Bug Fixes

* apollo compatibility for truncating floats, invalid __typenames ([#1242](https://github.com/wundergraph/cosmo/issues/1242)) ([a773ea5](https://github.com/wundergraph/cosmo/commit/a773ea53d7f9abe48033dad822f4424a31e28af2)) (@devsergiy)

# [0.26.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.25.0...aws-lambda-router@0.26.0) (2024-10-03)

### Features

* router version command ([#1240](https://github.com/wundergraph/cosmo/issues/1240)) ([39970e5](https://github.com/wundergraph/cosmo/commit/39970e5b1c6d8e2a2958f5ea55bb0d8aa7206d92)) (@StarpTech)

# [0.25.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.24.4...aws-lambda-router@0.25.0) (2024-10-02)

### Features

* add apollo compatibility flag to truncate floats ([#1236](https://github.com/wundergraph/cosmo/issues/1236)) ([17c80c9](https://github.com/wundergraph/cosmo/commit/17c80c91f4e594cf48dae887840517b588bbe0f8)) (@jensneuse)

## [0.24.4](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.24.3...aws-lambda-router@0.24.4) (2024-09-30)

### Bug Fixes

* upgrade engine for ws deadlock, remove pont pool ([#1230](https://github.com/wundergraph/cosmo/issues/1230)) ([3ac50f8](https://github.com/wundergraph/cosmo/commit/3ac50f8b878fb6a5e2460c22aa94412a28c49600)) (@StarpTech)

## [0.24.3](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.24.2...aws-lambda-router@0.24.3) (2024-09-30)

### Bug Fixes

* value completion reset, preserve __typename field location ([#1228](https://github.com/wundergraph/cosmo/issues/1228)) ([9d671f0](https://github.com/wundergraph/cosmo/commit/9d671f071af6d6b5789968682b98a9c5b7f9a7ec)) (@devsergiy)

## [0.24.2](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.24.1...aws-lambda-router@0.24.2) (2024-09-30)

### Bug Fixes

* planning of consecutive fragments and fragments on union ([#1223](https://github.com/wundergraph/cosmo/issues/1223)) ([3e390cd](https://github.com/wundergraph/cosmo/commit/3e390cd5cf6ca87694c6a25794aecd84d4f0c31e)) (@devsergiy)

## [0.24.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.24.0...aws-lambda-router@0.24.1) (2024-09-23)

**Note:** Version bump only for package aws-lambda-router

# [0.24.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.23.0...aws-lambda-router@0.24.0) (2024-09-23)

### Features

* add apollo compatibility mode with support for valueCompletion ([#1205](https://github.com/wundergraph/cosmo/issues/1205)) ([18b1ef0](https://github.com/wundergraph/cosmo/commit/18b1ef01b12945d2f3acc80ea9548a17f9effa21)) (@jensneuse)

# [0.23.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.22.2...aws-lambda-router@0.23.0) (2024-09-19)

### Features

* return error from Router when Subgraph returns invalid value for __typename field ([#1194](https://github.com/wundergraph/cosmo/issues/1194)) ([b99d2fd](https://github.com/wundergraph/cosmo/commit/b99d2fdcd8b311028d11b501addb9d69e61c7df8)) (@jensneuse)

## [0.22.2](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.22.1...aws-lambda-router@0.22.2) (2024-09-17)

### Bug Fixes

* ignore empty errors array ([#1181](https://github.com/wundergraph/cosmo/issues/1181)) ([bc5dda3](https://github.com/wundergraph/cosmo/commit/bc5dda393f727d8ee3483ea7e53c89377a0d2722)) (@devsergiy)

## [0.22.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.22.0...aws-lambda-router@0.22.1) (2024-09-13)

**Note:** Version bump only for package aws-lambda-router

# [0.22.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.21.5...aws-lambda-router@0.22.0) (2024-09-12)

### Features

* subgraph error propagation improvements ([#1164](https://github.com/wundergraph/cosmo/issues/1164)) ([2700061](https://github.com/wundergraph/cosmo/commit/27000616aa96de67a33e90fbddfcd851d815f2ab)) (@StarpTech)

## [0.21.5](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.21.4...aws-lambda-router@0.21.5) (2024-09-09)

**Note:** Version bump only for package aws-lambda-router

## [0.21.4](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.21.3...aws-lambda-router@0.21.4) (2024-08-30)

### Bug Fixes

* planning of provides, parent entity jump, conditional implicit keys, external fields ([#1092](https://github.com/wundergraph/cosmo/issues/1092)) ([0fe2cba](https://github.com/wundergraph/cosmo/commit/0fe2cbaa72fa7ba5dbbf97c1e95615f29f13af1f)) (@devsergiy)

## [0.21.3](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.21.2...aws-lambda-router@0.21.3) (2024-08-30)

### Bug Fixes

* support __typename for introspection query ([#1131](https://github.com/wundergraph/cosmo/issues/1131)) ([704170e](https://github.com/wundergraph/cosmo/commit/704170e7417ce6352b5eaea63b65f3dc5b772dd8)) (@devsergiy)

## [0.21.2](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.21.1...aws-lambda-router@0.21.2) (2024-08-22)

### Bug Fixes

* unicode escaping by replacing fastjson version ([#1109](https://github.com/wundergraph/cosmo/issues/1109)) ([9d7812a](https://github.com/wundergraph/cosmo/commit/9d7812a03983eb6422e5e636e367814b1cc9b1fa)) (@devsergiy)

## [0.21.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.21.0...aws-lambda-router@0.21.1) (2024-08-14)

**Note:** Version bump only for package aws-lambda-router

# [0.21.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.20.0...aws-lambda-router@0.21.0) (2024-08-14)

### Features

* expose query plans through response extensions field ([#1077](https://github.com/wundergraph/cosmo/issues/1077)) ([58430bc](https://github.com/wundergraph/cosmo/commit/58430bc7c90b2b21500a1471ef929950d0f0ce1a)) (@jensneuse)

# [0.20.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.19.0...aws-lambda-router@0.20.0) (2024-08-09)

### Features

* add fetch tree resolver ([#1019](https://github.com/wundergraph/cosmo/issues/1019)) ([4f4dee7](https://github.com/wundergraph/cosmo/commit/4f4dee765ba73cabba7ff4fe95faa4e4935505ba)) (@jensneuse)

# [0.19.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.18.1...aws-lambda-router@0.19.0) (2024-08-06)

### Features

* config file watcher ([#1013](https://github.com/wundergraph/cosmo/issues/1013)) ([d023d49](https://github.com/wundergraph/cosmo/commit/d023d4942a67dc80ac4e96be9249e8ea53c2ccaa)) (@StarpTech)

## [0.18.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.18.0...aws-lambda-router@0.18.1) (2024-08-02)

### Bug Fixes

* replace jsonparser with fastjson to delete exported variables ([#999](https://github.com/wundergraph/cosmo/issues/999)) ([0e3307e](https://github.com/wundergraph/cosmo/commit/0e3307e24c7e5185e35ab34f9f5c14903c4085d0)) (@jensneuse)

# [0.18.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.17.3...aws-lambda-router@0.18.0) (2024-08-01)

### Features

* implement s3 provider for config and persistent operations ([#971](https://github.com/wundergraph/cosmo/issues/971)) ([e3206ff](https://github.com/wundergraph/cosmo/commit/e3206fff9c1796a64173be350445514f26db9296)) (@StarpTech)

## [0.17.3](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.17.2...aws-lambda-router@0.17.3) (2024-07-31)

### Bug Fixes

* excessive memory usage for big responses by disabling big pre-al… ([#986](https://github.com/wundergraph/cosmo/issues/986)) ([9aa5f29](https://github.com/wundergraph/cosmo/commit/9aa5f29cbaa12797753f280e49d32b6eed7c11b5)) (@jensneuse)

## [0.17.2](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.17.1...aws-lambda-router@0.17.2) (2024-07-30)

### Bug Fixes

* input coercion for nested values ([#981](https://github.com/wundergraph/cosmo/issues/981)) ([5494e5f](https://github.com/wundergraph/cosmo/commit/5494e5f3075db7795c100c927001a4baae212c68)) (@jensneuse)

## [0.17.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.17.0...aws-lambda-router@0.17.1) (2024-07-24)

### Bug Fixes

* variable list coercion with normalization cache ([#956](https://github.com/wundergraph/cosmo/issues/956)) ([104ebe8](https://github.com/wundergraph/cosmo/commit/104ebe8f49b6975d10e897d767fb8d627e54145e)) (@jensneuse)

# [0.17.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.16.0...aws-lambda-router@0.17.0) (2024-07-22)

### Features

* expose normalization cache hit and acquire resolver wait time via otel ([#951](https://github.com/wundergraph/cosmo/issues/951)) ([e39437b](https://github.com/wundergraph/cosmo/commit/e39437b0164b99233bd182cda636cbc0392c556d)) (@StarpTech)

# [0.16.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.15.5...aws-lambda-router@0.16.0) (2024-07-18)

### Features

* improve JSON parsing & merging in the engine ([#937](https://github.com/wundergraph/cosmo/issues/937)) ([1717e16](https://github.com/wundergraph/cosmo/commit/1717e1659388f89cf3cc541c99b54bde5885fe17)) (@jensneuse)

## [0.15.5](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.15.4...aws-lambda-router@0.15.5) (2024-07-09)

### Bug Fixes

* upgrade deps due to found CVEs ([#926](https://github.com/wundergraph/cosmo/issues/926)) ([fc6e615](https://github.com/wundergraph/cosmo/commit/fc6e6158e2e761489033acb667cd0b36920c2612)) (@StarpTech)

## [0.15.4](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.15.3...aws-lambda-router@0.15.4) (2024-07-05)

**Note:** Version bump only for package aws-lambda-router

## [0.15.3](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.15.2...aws-lambda-router@0.15.3) (2024-07-04)

**Note:** Version bump only for package aws-lambda-router

## [0.15.2](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.15.1...aws-lambda-router@0.15.2) (2024-07-01)

### Bug Fixes

* merging deeply nested representation variables ([#902](https://github.com/wundergraph/cosmo/issues/902)) ([daa5b40](https://github.com/wundergraph/cosmo/commit/daa5b404ab9b7cf81553d089ebaeb26927c6c706)) (@devsergiy)

## [0.15.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.15.0...aws-lambda-router@0.15.1) (2024-06-26)

### Bug Fixes

* fix merging response nodes edge cases ([#897](https://github.com/wundergraph/cosmo/issues/897)) ([f5247db](https://github.com/wundergraph/cosmo/commit/f5247db8e80bd7d9224fd08c894a305bec035548)) (@devsergiy)

# [0.15.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.14.1...aws-lambda-router@0.15.0) (2024-06-26)

### Features

* support file upload in router ([#772](https://github.com/wundergraph/cosmo/issues/772)) ([d1cbc11](https://github.com/wundergraph/cosmo/commit/d1cbc11deedbdefad949a3aa5a1b753da4682145)) (@pedraumcosta)

## [0.14.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.14.0...aws-lambda-router@0.14.1) (2024-06-25)

### Bug Fixes

* merging response nodes ([#888](https://github.com/wundergraph/cosmo/issues/888)) ([fb4b1a7](https://github.com/wundergraph/cosmo/commit/fb4b1a70eb1afec928551543f359d08eedae8863)) (@devsergiy)

# [0.14.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.13.2...aws-lambda-router@0.14.0) (2024-06-25)

### Features

* add config option to enable subgraph minify ([#887](https://github.com/wundergraph/cosmo/issues/887)) ([a89c11a](https://github.com/wundergraph/cosmo/commit/a89c11ab283b24349d7e5d2502779c4ac71df877)) (@jensneuse)

## [0.13.2](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.13.1...aws-lambda-router@0.13.2) (2024-06-24)

### Bug Fixes

* **engine-update:** processing websockets dials asynchronously ([#881](https://github.com/wundergraph/cosmo/issues/881)) ([130cb33](https://github.com/wundergraph/cosmo/commit/130cb3325a1ff78c180e604ebacc480525f36848)) (@StarpTech)

## [0.13.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.13.0...aws-lambda-router@0.13.1) (2024-06-20)

### Bug Fixes

* requires planning, normalization of default values ([#867](https://github.com/wundergraph/cosmo/issues/867)) ([2ec6ef1](https://github.com/wundergraph/cosmo/commit/2ec6ef1b6be274203b59af338ff4f30ec97acb01)) (@devsergiy)

# [0.13.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.12.0...aws-lambda-router@0.13.0) (2024-06-06)

### Features

* handle creating, publishing, and updating Event-Driven Graphs ([#855](https://github.com/wundergraph/cosmo/issues/855)) ([fc2a8f2](https://github.com/wundergraph/cosmo/commit/fc2a8f20b97a17d0927c589f81df66ff7abf78c5)) (@Aenimus)

# [0.12.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.11.2...aws-lambda-router@0.12.0) (2024-05-31)

### Features

* support multiple/static NATS EDFS arg templates ([#841](https://github.com/wundergraph/cosmo/issues/841)) ([2c75870](https://github.com/wundergraph/cosmo/commit/2c75870cc65d5a43e864f69e39f202170257f9df)) (@Aenimus)

## [0.11.2](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.11.1...aws-lambda-router@0.11.2) (2024-05-29)

**Note:** Version bump only for package aws-lambda-router

## [0.11.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.11.0...aws-lambda-router@0.11.1) (2024-05-28)

### Bug Fixes

* merging response nodes, improve playground trace for skipped fetches ([#827](https://github.com/wundergraph/cosmo/issues/827)) ([70fc005](https://github.com/wundergraph/cosmo/commit/70fc005f3e2e7826d8f517de5f42119b96f95e79)) (@devsergiy)

# [0.11.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.10.1...aws-lambda-router@0.11.0) (2024-05-27)

### Features

* add support for response compression ([#723](https://github.com/wundergraph/cosmo/issues/723)) ([a6c6ac4](https://github.com/wundergraph/cosmo/commit/a6c6ac415f79ad1e5a85e1bbd95337c13b47616f)) (@Rutik7066)

## [0.10.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.10.0...aws-lambda-router@0.10.1) (2024-05-22)

### Bug Fixes

* level of null data propagation ([#812](https://github.com/wundergraph/cosmo/issues/812)) ([e6d92d6](https://github.com/wundergraph/cosmo/commit/e6d92d6adab101cf44756151961f15583f435ed8)) (@Aenimus)

# [0.10.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.9.0...aws-lambda-router@0.10.0) (2024-05-21)

### Features

* implement subscription filter ([#780](https://github.com/wundergraph/cosmo/issues/780)) ([444a766](https://github.com/wundergraph/cosmo/commit/444a766b07de1998df52174a5a2e65086605e14c)) (@Aenimus)

# [0.9.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.8.0...aws-lambda-router@0.9.0) (2024-05-21)

### Features

* add support for websocket subprotocol ([#776](https://github.com/wundergraph/cosmo/issues/776)) ([e35aa26](https://github.com/wundergraph/cosmo/commit/e35aa262227b29f09ddfdd1ce361c010b769b2da)) (@JivusAyrus)

# [0.8.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.7.6...aws-lambda-router@0.8.0) (2024-05-14)

### Bug Fixes

* usage of fragments on root query type, fix normalization issues ([#789](https://github.com/wundergraph/cosmo/issues/789)) ([e9239b4](https://github.com/wundergraph/cosmo/commit/e9239b40c938638eb11c94b858a436371474e7a5)) (@devsergiy)

### Features

* refactor edfs and add kafka support ([#770](https://github.com/wundergraph/cosmo/issues/770)) ([d659067](https://github.com/wundergraph/cosmo/commit/d659067fd1d094621788f42bac6d121b0831ebb7)) (@StarpTech)

## [0.7.6](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.7.5...aws-lambda-router@0.7.6) (2024-05-10)

### Bug Fixes

* root level [@requires](https://github.com/requires) planning ([#779](https://github.com/wundergraph/cosmo/issues/779)) ([30113b3](https://github.com/wundergraph/cosmo/commit/30113b3d78d651c58e8c0ec5d7123f5bd7ff3ec5)) (@devsergiy)

## [0.7.5](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.7.4...aws-lambda-router@0.7.5) (2024-05-06)

### Bug Fixes

* ignore unknown router execution config fields ([#767](https://github.com/wundergraph/cosmo/issues/767)) ([649a0e1](https://github.com/wundergraph/cosmo/commit/649a0e1349820642491469890f9eaa7b1134e430)) (@Aenimus)

## [0.7.4](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.7.3...aws-lambda-router@0.7.4) (2024-04-30)

### Bug Fixes

* normalization of non-compatible nested fragment types ([#761](https://github.com/wundergraph/cosmo/issues/761)) ([3f42a17](https://github.com/wundergraph/cosmo/commit/3f42a171d2d7a32b24ba695aadfa8bfba85c8e39)) (@devsergiy)

## [0.7.3](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.7.2...aws-lambda-router@0.7.3) (2024-04-29)

### Bug Fixes

* field selection validation ([#758](https://github.com/wundergraph/cosmo/issues/758)) ([d29fbc6](https://github.com/wundergraph/cosmo/commit/d29fbc60df212eb6191a3fb4bbbd47d45de439cd)) (@devsergiy)

## [0.7.2](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.7.1...aws-lambda-router@0.7.2) (2024-04-18)

**Note:** Version bump only for package aws-lambda-router

## [0.7.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.7.0...aws-lambda-router@0.7.1) (2024-04-12)

**Note:** Version bump only for package aws-lambda-router

# [0.7.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.6.0...aws-lambda-router@0.7.0) (2024-04-11)

### Features

* support entity targets (implicit keys) ([#724](https://github.com/wundergraph/cosmo/issues/724)) ([4aa2c86](https://github.com/wundergraph/cosmo/commit/4aa2c86961384d913e964437b7ea369accb891c7)) (@Aenimus)

# [0.6.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.5.0...aws-lambda-router@0.6.0) (2024-04-09)

### Features

* support edfs subscription stream/consumer; multiple subjects ([#685](https://github.com/wundergraph/cosmo/issues/685)) ([c70b2ae](https://github.com/wundergraph/cosmo/commit/c70b2aefd39c45b5f98eae8a3c43f639d56064b2)) (@Aenimus)

# [0.5.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.4.0...aws-lambda-router@0.5.0) (2024-03-24)

### Features

* multi platform docker builds ([#665](https://github.com/wundergraph/cosmo/issues/665)) ([4c24d70](https://github.com/wundergraph/cosmo/commit/4c24d7075bd48cd946a1037bffc0c4fcaef74289)) (@StarpTech)

# [0.4.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.3.1...aws-lambda-router@0.4.0) (2024-03-13)

### Features

* add edfs validation; add event source name keys to config ([#624](https://github.com/wundergraph/cosmo/issues/624)) ([bf03bb8](https://github.com/wundergraph/cosmo/commit/bf03bb8fca1838fefebcb150f8924ec52fb8bdb5)) (@Aenimus)

## [0.3.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.3.0...aws-lambda-router@0.3.1) (2024-02-20)

**Note:** Version bump only for package aws-lambda-router

# [0.3.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.2.0...aws-lambda-router@0.3.0) (2024-02-17)

### Features

* use json schema to validate and document router config ([#545](https://github.com/wundergraph/cosmo/issues/545)) ([ec700ba](https://github.com/wundergraph/cosmo/commit/ec700bae0224d3d0180b8d56800f48c9002dcee5)) (@StarpTech)

# [0.2.0](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.1.1...aws-lambda-router@0.2.0) (2024-01-26)

### Features

* namespaces ([#447](https://github.com/wundergraph/cosmo/issues/447)) ([bbe5258](https://github.com/wundergraph/cosmo/commit/bbe5258c5e764c52947f831d3a7f1a2f93c267d4)) (@thisisnithin)

## [0.1.1](https://github.com/wundergraph/cosmo/compare/aws-lambda-router@0.1.0...aws-lambda-router@0.1.1) (2024-01-22)

**Note:** Version bump only for package aws-lambda-router

# 0.1.0 (2024-01-22)

### Features

* **router:** aws lambda support ([#446](https://github.com/wundergraph/cosmo/issues/446)) ([9c7d386](https://github.com/wundergraph/cosmo/commit/9c7d38697ec5196326fb87d9cdadec5bc9b564f4)) (@StarpTech)
