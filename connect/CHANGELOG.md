# Change Log
Binaries are attached to the github release otherwise all images can be found [here](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.119.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.118.0...@wundergraph/cosmo-connect@0.119.0) (2025-09-16)

### Features

* improve namespace selector UI/UX ([#2161](https://github.com/wundergraph/cosmo/issues/2161)) ([33f870e](https://github.com/wundergraph/cosmo/commit/33f870e8b33751ce547b33eb9ca6cb12578f4034)) (@wilsonrivera)

# [0.118.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.117.0...@wundergraph/cosmo-connect@0.118.0) (2025-09-10)

### Features

* add a feature to link subgraphs across namespaces ([#2156](https://github.com/wundergraph/cosmo/issues/2156)) ([e1abdea](https://github.com/wundergraph/cosmo/commit/e1abdeab80ee2fe8ccdff1ce963787280a86dee9)) (@JivusAyrus)

# [0.117.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.116.0...@wundergraph/cosmo-connect@0.117.0) (2025-09-10)

### Features

* implement openfed__requireFetchReasons ([#2170](https://github.com/wundergraph/cosmo/issues/2170)) ([cfb097f](https://github.com/wundergraph/cosmo/commit/cfb097fb6ccc29a81cfca55fec6b71fdf6e1b61c)) (@Aenimus)

# [0.116.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.115.2...@wundergraph/cosmo-connect@0.116.0) (2025-08-12)

### Features

* add support for plugins ([#2079](https://github.com/wundergraph/cosmo/issues/2079)) ([05c923a](https://github.com/wundergraph/cosmo/commit/05c923aaa09a898a1662fc40d0e5751dfa5b8fe1)) (@JivusAyrus)

## [0.115.2](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.115.1...@wundergraph/cosmo-connect@0.115.2) (2025-08-08)

### Bug Fixes

* use federated graph id and org id to fetch operation content ([#2107](https://github.com/wundergraph/cosmo/issues/2107)) ([cfe1036](https://github.com/wundergraph/cosmo/commit/cfe10361e0d756f803ef4210b5efa46c3f16d8bb)) (@JivusAyrus)

## [0.115.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.115.0...@wundergraph/cosmo-connect@0.115.1) (2025-07-31)

### Bug Fixes

* take limit as input so the no of operations returned is always limited ([#2095](https://github.com/wundergraph/cosmo/issues/2095)) ([80691fe](https://github.com/wundergraph/cosmo/commit/80691fe5b30011f8212380ffea769b141fa121d5)) (@JivusAyrus)

# [0.115.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.114.0...@wundergraph/cosmo-connect@0.115.0) (2025-07-21)

### Features

* add disable resolvability validation flag ([#2065](https://github.com/wundergraph/cosmo/issues/2065)) ([0c920cc](https://github.com/wundergraph/cosmo/commit/0c920cc95065099667fc378b50e9278e8a99c286)) (@Aenimus)

# [0.114.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.113.0...@wundergraph/cosmo-connect@0.114.0) (2025-07-09)

### Features

* return the proposal name on the creation of proposal ([#2003](https://github.com/wundergraph/cosmo/issues/2003)) ([ff1b237](https://github.com/wundergraph/cosmo/commit/ff1b2376921db2db7ac2a9d1619824eb1ae1e76d)) (@JivusAyrus)

# [0.113.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.112.0...@wundergraph/cosmo-connect@0.113.0) (2025-07-01)

### Bug Fixes

* toggle ui logic and search to consider all operations ([#1982](https://github.com/wundergraph/cosmo/issues/1982)) ([e6264bd](https://github.com/wundergraph/cosmo/commit/e6264bd5fc98962b2b36f21a3a20c802333192f1)) (@JivusAyrus)

### Features

* allow organization members to be assigned multiple groups ([#1919](https://github.com/wundergraph/cosmo/issues/1919)) ([1e67757](https://github.com/wundergraph/cosmo/commit/1e677576a32efb89673cdfc3900a4c863eec8b7e)) (@wilsonrivera)

# [0.112.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.111.0...@wundergraph/cosmo-connect@0.112.0) (2025-06-26)

### Features

* add redis pubsub support to EDFS ([#1810](https://github.com/wundergraph/cosmo/issues/1810)) ([8f294b6](https://github.com/wundergraph/cosmo/commit/8f294b62c14e9cae7e1ad85e65b0ca3ada0bcfbb)) (@alepane21)

# [0.111.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.110.0...@wundergraph/cosmo-connect@0.111.0) (2025-06-06)

### Features

* link organization to the root keycloak group ([#1920](https://github.com/wundergraph/cosmo/issues/1920)) ([2952533](https://github.com/wundergraph/cosmo/commit/2952533b7dbdf29dd71f97b21c92c834ba1f1c97)) (@wilsonrivera)

# [0.110.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.109.0...@wundergraph/cosmo-connect@0.110.0) (2025-06-02)

### Features

* add GetClientsFromAnalytics RPC to fetch the clients using clickhouse metrics ([#1918](https://github.com/wundergraph/cosmo/issues/1918)) ([756edf3](https://github.com/wundergraph/cosmo/commit/756edf377314296adc50615f12c618b98e78810d)) (@JivusAyrus)

# [0.109.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.108.0...@wundergraph/cosmo-connect@0.109.0) (2025-05-28)

### Features

* return proposalUrl on creation of proposal ([#1909](https://github.com/wundergraph/cosmo/issues/1909)) ([b21db02](https://github.com/wundergraph/cosmo/commit/b21db02185c37b47bd0c1db0fba872d1868017bd)) (@JivusAyrus)

# [0.108.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.107.0...@wundergraph/cosmo-connect@0.108.0) (2025-05-26)

### Features

* fetch operations based on clients ([#1894](https://github.com/wundergraph/cosmo/issues/1894)) ([a7597f5](https://github.com/wundergraph/cosmo/commit/a7597f51d4506f11f117937955da3be2626a55c5)) (@JivusAyrus)

# [0.107.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.106.0...@wundergraph/cosmo-connect@0.107.0) (2025-05-25)

### Features

* improve available namespaces ([#1895](https://github.com/wundergraph/cosmo/issues/1895)) ([135de0a](https://github.com/wundergraph/cosmo/commit/135de0a4c57ce815e1177be34e96c2a5900f031e)) (@wilsonrivera)

# [0.106.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.105.0...@wundergraph/cosmo-connect@0.106.0) (2025-05-24)

### Features

* introduce RBAC groups for fine-grained control over resource access ([#1830](https://github.com/wundergraph/cosmo/issues/1830)) ([9f984cd](https://github.com/wundergraph/cosmo/commit/9f984cdfedbb80e0e120178b9755d6f57e85479e)) (@wilsonrivera)

# [0.105.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.104.0...@wundergraph/cosmo-connect@0.105.0) (2025-05-19)

### Features

* **router:** grpc go plugin system ([#1866](https://github.com/wundergraph/cosmo/issues/1866)) ([280a61d](https://github.com/wundergraph/cosmo/commit/280a61de4bd1328549a023d1a3a0b702d78453b8)) (@Noroth)

# [0.104.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.103.0...@wundergraph/cosmo-connect@0.104.0) (2025-05-16)

### Features

* get all the operations of a federated graph ([#1856](https://github.com/wundergraph/cosmo/issues/1856)) ([246b514](https://github.com/wundergraph/cosmo/commit/246b5149921827d2e2c4954086e3e5f4dd5815b2)) (@JivusAyrus)

# [0.103.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.102.1...@wundergraph/cosmo-connect@0.103.0) (2025-05-13)

### Features

* allow to check new subgraphs ([#1761](https://github.com/wundergraph/cosmo/issues/1761)) ([5b0bfbf](https://github.com/wundergraph/cosmo/commit/5b0bfbf38e77893453dc6bdfb4d524df1f59881b)) (@JivusAyrus)

## [0.102.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.102.0...@wundergraph/cosmo-connect@0.102.1) (2025-04-29)

### Bug Fixes

* improve the queries of the check page ([#1811](https://github.com/wundergraph/cosmo/issues/1811)) ([ce4f377](https://github.com/wundergraph/cosmo/commit/ce4f377c53584299a86c0af1bc5b4bb87c825bfe)) (@JivusAyrus)

# [0.102.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.101.0...@wundergraph/cosmo-connect@0.102.0) (2025-04-15)

### Features

* implement proposals in cosmo ([#1727](https://github.com/wundergraph/cosmo/issues/1727)) ([1d36747](https://github.com/wundergraph/cosmo/commit/1d36747dda3f2f3c491092f0f02cefa22fc9c131)) (@JivusAyrus)

# [0.101.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.100.0...@wundergraph/cosmo-connect@0.101.0) (2025-04-07)

### Features

* check with multiple subgraph schemas ([#1712](https://github.com/wundergraph/cosmo/issues/1712)) ([77370a4](https://github.com/wundergraph/cosmo/commit/77370a4729034b9c037831f14dcfc30ab44d71ef)) (@JivusAyrus)

# [0.100.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.99.0...@wundergraph/cosmo-connect@0.100.0) (2025-04-04)

### Features

* improve delete organization workflow ([#1741](https://github.com/wundergraph/cosmo/issues/1741)) ([643c179](https://github.com/wundergraph/cosmo/commit/643c179f71daf5a77a56c685b3924d10894c2d9c)) (@wilsonrivera)

# [0.99.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.98.1...@wundergraph/cosmo-connect@0.99.0) (2025-04-01)

### Features

* remove discussions ([#1735](https://github.com/wundergraph/cosmo/issues/1735)) ([cbb6117](https://github.com/wundergraph/cosmo/commit/cbb61171505fd3fa67f501583d92002b0c807241)) (@thisisnithin)

## [0.98.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.98.0...@wundergraph/cosmo-connect@0.98.1) (2025-03-28)

### Bug Fixes

* authorization directive cascading ([#1733](https://github.com/wundergraph/cosmo/issues/1733)) ([0199fb5](https://github.com/wundergraph/cosmo/commit/0199fb5f88104a585b74a79638f54f1a3b812436)) (@Aenimus)

# [0.98.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.97.0...@wundergraph/cosmo-connect@0.98.0) (2025-03-25)

### Features

* allow to filter checks by subgraph name ([#1716](https://github.com/wundergraph/cosmo/issues/1716)) ([ae69dcd](https://github.com/wundergraph/cosmo/commit/ae69dcde94611196f7f8b47702e25cdcdfa41a19)) (@wilsonrivera)
* introduce `p50`, `p90` and `p99` latency metrics for graphs and subgraphs ([#1710](https://github.com/wundergraph/cosmo/issues/1710)) ([1c55ed5](https://github.com/wundergraph/cosmo/commit/1c55ed51fe17be7371633a176c356e581ed44c62)) (@wilsonrivera)

# [0.97.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.96.0...@wundergraph/cosmo-connect@0.97.0) (2025-03-20)

### Features

* implement checks configuration ([#1688](https://github.com/wundergraph/cosmo/issues/1688)) ([2cab283](https://github.com/wundergraph/cosmo/commit/2cab283b2cdeda7f943250d460150472eb464d22)) (@wilsonrivera)

# [0.96.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.95.0...@wundergraph/cosmo-connect@0.96.0) (2025-03-12)

### Features

* display used api key name on the audit log table ([#1674](https://github.com/wundergraph/cosmo/issues/1674)) ([55ffbdd](https://github.com/wundergraph/cosmo/commit/55ffbdd7ac0ae10106de4bf3c073d650c0537a52)) (@wilsonrivera)

# [0.95.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.94.1...@wundergraph/cosmo-connect@0.95.0) (2025-02-27)

### Features

* add option to set the number of operations for cache warming and implement FILO policy ([#1607](https://github.com/wundergraph/cosmo/issues/1607)) ([6867225](https://github.com/wundergraph/cosmo/commit/6867225dfcacf5e11b01394224dd9df5e9168dc8)) (@JivusAyrus)

## [0.94.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.94.0...@wundergraph/cosmo-connect@0.94.1) (2025-02-26)

### Bug Fixes

* improve wgc auth login and router compatibility-version ([#1636](https://github.com/wundergraph/cosmo/issues/1636)) ([6946363](https://github.com/wundergraph/cosmo/commit/6946363024e49b6170a9553728ac3ecc973ce394)) (@Aenimus)

# [0.94.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.93.0...@wundergraph/cosmo-connect@0.94.0) (2025-02-17)

### Features

* add composition versioning ([#1575](https://github.com/wundergraph/cosmo/issues/1575)) ([ee32cbb](https://github.com/wundergraph/cosmo/commit/ee32cbb3dbe7c46fa984920bbd95e4a00d01c9c3)) (@Aenimus)

# [0.93.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.92.0...@wundergraph/cosmo-connect@0.93.0) (2025-02-12)

### Features

* add option to delete cache operation ([#1586](https://github.com/wundergraph/cosmo/issues/1586)) ([2946139](https://github.com/wundergraph/cosmo/commit/29461397e784eec0880546807df51dbfd8f2918c)) (@JivusAyrus)

# [0.92.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.91.0...@wundergraph/cosmo-connect@0.92.0) (2025-01-24)

### Features

* add compatibility handshake between router and execution config ([#1534](https://github.com/wundergraph/cosmo/issues/1534)) ([4b8d60a](https://github.com/wundergraph/cosmo/commit/4b8d60ac48e1777069d68407ce72ea1d813155ca)) (@Aenimus)

# [0.91.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.90.1...@wundergraph/cosmo-connect@0.91.0) (2025-01-17)

### Features

* cache warmer ([#1501](https://github.com/wundergraph/cosmo/issues/1501)) ([948edd2](https://github.com/wundergraph/cosmo/commit/948edd23e6d0ee968c91edd1a9e9943c3405ac2d)) (@JivusAyrus)

## [0.90.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.90.0...@wundergraph/cosmo-connect@0.90.1) (2025-01-06)

### Bug Fixes

* add regex validation to graph names and routing urls ([#1450](https://github.com/wundergraph/cosmo/issues/1450)) ([e5b1c8f](https://github.com/wundergraph/cosmo/commit/e5b1c8fb33a41fc808067bb6495a43f74b60b314)) (@JivusAyrus)

# [0.90.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.89.0...@wundergraph/cosmo-connect@0.90.0) (2024-12-17)

### Features

* edfs nats create bespoke consumer ([#1443](https://github.com/wundergraph/cosmo/issues/1443)) ([af97af7](https://github.com/wundergraph/cosmo/commit/af97af71af0eb2de20dd5a0e0bc8cc454f1b0e38)) (@alepane21)

# [0.89.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.88.1...@wundergraph/cosmo-connect@0.89.0) (2024-12-03)

### Features

* add an option to update the readme, routing url and admission webhook url of a contract ([#1403](https://github.com/wundergraph/cosmo/issues/1403)) ([226bc9c](https://github.com/wundergraph/cosmo/commit/226bc9cd863e27537afd42ef23418c3acd06733a)) (@JivusAyrus)
* add apis to fetch fedGraph, subgraph and namespace by id ([#1386](https://github.com/wundergraph/cosmo/issues/1386)) ([66b3650](https://github.com/wundergraph/cosmo/commit/66b365061677d41b7218d289aad99f0661e5d51e)) (@JivusAyrus)

## [0.88.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.88.0...@wundergraph/cosmo-connect@0.88.1) (2024-11-27)

### Bug Fixes

* error ordering for traces ([#1398](https://github.com/wundergraph/cosmo/issues/1398)) ([444fb8d](https://github.com/wundergraph/cosmo/commit/444fb8dbc79a076c1a12c2a2ba813b91a19fc79d)) (@thisisnithin)

# [0.88.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.87.0...@wundergraph/cosmo-connect@0.88.0) (2024-11-18)

### Features

* add pagination to operations page in check summary ([#1377](https://github.com/wundergraph/cosmo/issues/1377)) ([e61d4f1](https://github.com/wundergraph/cosmo/commit/e61d4f12873fe434d89c9069b8a1b1e3da225ebf)) (@JivusAyrus)

# [0.87.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.86.0...@wundergraph/cosmo-connect@0.87.0) (2024-10-31)

### Features

* custom scripts ([#1302](https://github.com/wundergraph/cosmo/issues/1302)) ([9f4457c](https://github.com/wundergraph/cosmo/commit/9f4457c7f7acdf2f56cc3ad7f0474653063f290c)) (@thisisnithin)

# [0.86.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.85.1...@wundergraph/cosmo-connect@0.86.0) (2024-10-28)

### Features

* propagate warnings from composition ([#1298](https://github.com/wundergraph/cosmo/issues/1298)) ([174c11b](https://github.com/wundergraph/cosmo/commit/174c11bca599e773faa2f53ff31efd8aba238ff3)) (@JivusAyrus)

## [0.85.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.85.0...@wundergraph/cosmo-connect@0.85.1) (2024-10-24)

**Note:** Version bump only for package @wundergraph/cosmo-connect

# [0.85.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.84.0...@wundergraph/cosmo-connect@0.85.0) (2024-10-09)

### Features

* add custom context to subgraph checks ([#1252](https://github.com/wundergraph/cosmo/issues/1252)) ([c510628](https://github.com/wundergraph/cosmo/commit/c510628bc8ca80a88b681d87051940361605ff5b)) (@JivusAyrus)

# [0.84.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.83.1...@wundergraph/cosmo-connect@0.84.0) (2024-09-27)

### Features

* add option to update the mappers of an IDP ([#1222](https://github.com/wundergraph/cosmo/issues/1222)) ([00c7b2e](https://github.com/wundergraph/cosmo/commit/00c7b2e159790c99ec62d3c7d6f99c0ef7c8bb70)) (@JivusAyrus)

## [0.83.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.83.0...@wundergraph/cosmo-connect@0.83.1) (2024-09-25)

### Bug Fixes

* record if linters were skipped for a check run ([#1217](https://github.com/wundergraph/cosmo/issues/1217)) ([9cdee41](https://github.com/wundergraph/cosmo/commit/9cdee416b288a08120ea5d8a09e054cf5f3fb5bd)) (@thisisnithin)

# [0.83.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.82.1...@wundergraph/cosmo-connect@0.83.0) (2024-09-23)

### Features

* option to skip traffic check in schema check ([#1211](https://github.com/wundergraph/cosmo/issues/1211)) ([d9fd83a](https://github.com/wundergraph/cosmo/commit/d9fd83ab99d2f2fc8e5f99a4cdb3abb8a1a7837c)) (@thisisnithin)

## [0.82.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.82.0...@wundergraph/cosmo-connect@0.82.1) (2024-09-20)

### Bug Fixes

* handle duplicate traces with same traceId ([#1190](https://github.com/wundergraph/cosmo/issues/1190)) ([b562816](https://github.com/wundergraph/cosmo/commit/b562816cc5b0dd9477590966fb9dcf7f10de3444)) (@thisisnithin)

# [0.82.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.81.1...@wundergraph/cosmo-connect@0.82.0) (2024-09-19)

### Features

* add graph pruning ([#1133](https://github.com/wundergraph/cosmo/issues/1133)) ([b5718cd](https://github.com/wundergraph/cosmo/commit/b5718cd66bc7f0d14cb16b3d0a6d395e846968e4)) (@JivusAyrus)

## [0.81.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.81.0...@wundergraph/cosmo-connect@0.81.1) (2024-09-17)

### Bug Fixes

* remove lastUsedAt for graph tokens ([#1180](https://github.com/wundergraph/cosmo/issues/1180)) ([9ac1590](https://github.com/wundergraph/cosmo/commit/9ac159070f122b45aaa37661143575cfa8fa5b27)) (@thisisnithin)

# [0.81.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.80.0...@wundergraph/cosmo-connect@0.81.0) (2024-09-05)

### Features

* record changed subgraphs in composition ([#1134](https://github.com/wundergraph/cosmo/issues/1134)) ([f39ca8c](https://github.com/wundergraph/cosmo/commit/f39ca8c4dcd54bb3d9594bc8394ef287a7eb04cd)) (@thisisnithin)

# [0.80.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.79.1...@wundergraph/cosmo-connect@0.80.0) (2024-08-19)

### Features

* export cli cmds output in json ([#1088](https://github.com/wundergraph/cosmo/issues/1088)) ([32c597c](https://github.com/wundergraph/cosmo/commit/32c597c1bcab88a1d820ea83f978fa811d8e3768)) (@JivusAyrus)

## [0.79.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.79.0...@wundergraph/cosmo-connect@0.79.1) (2024-08-14)

**Note:** Version bump only for package @wundergraph/cosmo-connect

# [0.79.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.78.0...@wundergraph/cosmo-connect@0.79.0) (2024-08-09)

### Features

* global override for all operations in check ([#1044](https://github.com/wundergraph/cosmo/issues/1044)) ([6eb0e4d](https://github.com/wundergraph/cosmo/commit/6eb0e4dce9373260b12b4f7fd07f7637349bf2eb)) (@thisisnithin)
* webhook history view ([#1036](https://github.com/wundergraph/cosmo/issues/1036)) ([4457a57](https://github.com/wundergraph/cosmo/commit/4457a5735e86bd655bed685aca66287ed743e08c)) (@thisisnithin)

# [0.78.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.77.1...@wundergraph/cosmo-connect@0.78.0) (2024-08-09)

### Features

* add command to create and publish feature subgraph in one command ([#960](https://github.com/wundergraph/cosmo/issues/960)) ([9a478e8](https://github.com/wundergraph/cosmo/commit/9a478e8164bfc7c933fedbe6188d7876e5c46c94)) (@JivusAyrus)

## [0.77.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.77.0...@wundergraph/cosmo-connect@0.77.1) (2024-07-16)

**Note:** Version bump only for package @wundergraph/cosmo-connect

# [0.77.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.76.0...@wundergraph/cosmo-connect@0.77.0) (2024-07-10)

### Features

* delete user ([#906](https://github.com/wundergraph/cosmo/issues/906)) ([5d438a1](https://github.com/wundergraph/cosmo/commit/5d438a1a2e1be610ff0e139efd692ed798daf677)) (@thisisnithin)

# [0.76.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.75.2...@wundergraph/cosmo-connect@0.76.0) (2024-07-03)

### Features

* feature flags ([#853](https://github.com/wundergraph/cosmo/issues/853)) ([5461bb5](https://github.com/wundergraph/cosmo/commit/5461bb5a529decd51a1b22be0a5301936b8ad392)) (@JivusAyrus)

## [0.75.2](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.75.1...@wundergraph/cosmo-connect@0.75.2) (2024-06-25)

### Bug Fixes

* cleanup inspectable check ([#884](https://github.com/wundergraph/cosmo/issues/884)) ([5bcf149](https://github.com/wundergraph/cosmo/commit/5bcf14915115d400ea6dc394b5d219e4f6e2eaca)) (@thisisnithin)

## [0.75.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.75.0...@wundergraph/cosmo-connect@0.75.1) (2024-06-24)

### Bug Fixes

* link composition from changelog ([#857](https://github.com/wundergraph/cosmo/issues/857)) ([45ebcfc](https://github.com/wundergraph/cosmo/commit/45ebcfcb30d7f0aa083ba0dc7798bf6678847091)) (@thisisnithin)

# [0.75.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.74.1...@wundergraph/cosmo-connect@0.75.0) (2024-06-20)

### Features

* add subscripion protocol and ws subprotocol to ui ([#829](https://github.com/wundergraph/cosmo/issues/829)) ([26708e4](https://github.com/wundergraph/cosmo/commit/26708e4d02fa3a6fa44b39a8c9138bd14a78c96f)) (@JivusAyrus)

## [0.74.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.74.0...@wundergraph/cosmo-connect@0.74.1) (2024-06-07)

**Note:** Version bump only for package @wundergraph/cosmo-connect

# [0.74.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.73.0...@wundergraph/cosmo-connect@0.74.0) (2024-06-06)

### Features

* handle creating, publishing, and updating Event-Driven Graphs ([#855](https://github.com/wundergraph/cosmo/issues/855)) ([fc2a8f2](https://github.com/wundergraph/cosmo/commit/fc2a8f20b97a17d0927c589f81df66ff7abf78c5)) (@Aenimus)

# [0.73.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.72.4...@wundergraph/cosmo-connect@0.73.0) (2024-06-05)

### Features

* admission webhook signature ([#852](https://github.com/wundergraph/cosmo/issues/852)) ([9212bb3](https://github.com/wundergraph/cosmo/commit/9212bb3aa3f3ca41f38c7944c3e6022c5fdc3ca8)) (@thisisnithin)

## [0.72.4](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.72.3...@wundergraph/cosmo-connect@0.72.4) (2024-05-30)

### Bug Fixes

* remove unused check run id causing overflow ([#838](https://github.com/wundergraph/cosmo/issues/838)) ([7fcc5f0](https://github.com/wundergraph/cosmo/commit/7fcc5f06687f5e534ba4056aff4b24d029cd8335)) (@thisisnithin)

## [0.72.3](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.72.2...@wundergraph/cosmo-connect@0.72.3) (2024-05-29)

### Bug Fixes

* prevent subgraph update except schema in publish ([#831](https://github.com/wundergraph/cosmo/issues/831)) ([37a9701](https://github.com/wundergraph/cosmo/commit/37a9701a2b9c61a9ecd489584cd6e2a9fe7ab70b)) (@thisisnithin)

## [0.72.2](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.72.1...@wundergraph/cosmo-connect@0.72.2) (2024-05-24)

### Bug Fixes

* unset admission webhook using empty string ([#820](https://github.com/wundergraph/cosmo/issues/820)) ([eaf470e](https://github.com/wundergraph/cosmo/commit/eaf470e6b31f828b8b316751337b739c4c158e5d)) (@thisisnithin)

## [0.72.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.72.0...@wundergraph/cosmo-connect@0.72.1) (2024-05-22)

### Bug Fixes

* playground config, subgraphs and members table, graph visualization ([#809](https://github.com/wundergraph/cosmo/issues/809)) ([bbdb8cd](https://github.com/wundergraph/cosmo/commit/bbdb8cd858a008051cd1ebb76d5d5f21a33f541a)) (@thisisnithin)

# [0.72.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.71.0...@wundergraph/cosmo-connect@0.72.0) (2024-05-21)

### Features

* implement subscription filter ([#780](https://github.com/wundergraph/cosmo/issues/780)) ([444a766](https://github.com/wundergraph/cosmo/commit/444a766b07de1998df52174a5a2e65086605e14c)) (@Aenimus)

# [0.71.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.70.0...@wundergraph/cosmo-connect@0.71.0) (2024-05-21)

### Features

* add support for websocket subprotocol ([#776](https://github.com/wundergraph/cosmo/issues/776)) ([e35aa26](https://github.com/wundergraph/cosmo/commit/e35aa262227b29f09ddfdd1ce361c010b769b2da)) (@JivusAyrus)

# [0.70.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.69.0...@wundergraph/cosmo-connect@0.70.0) (2024-05-17)

### Features

* schema contracts ([#751](https://github.com/wundergraph/cosmo/issues/751)) ([1bc1a78](https://github.com/wundergraph/cosmo/commit/1bc1a787f046d25f0a4affb3fe42efe39a1c6539)) (@thisisnithin)

# [0.69.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.68.0...@wundergraph/cosmo-connect@0.69.0) (2024-05-14)

### Features

* refactor edfs and add kafka support ([#770](https://github.com/wundergraph/cosmo/issues/770)) ([d659067](https://github.com/wundergraph/cosmo/commit/d659067fd1d094621788f42bac6d121b0831ebb7)) (@StarpTech)

# [0.68.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.67.0...@wundergraph/cosmo-connect@0.68.0) (2024-05-03)

### Features

* support inaccessible and add foundation for contracts ([#764](https://github.com/wundergraph/cosmo/issues/764)) ([08a7db2](https://github.com/wundergraph/cosmo/commit/08a7db222ce1763ffe8062d3792c41e0c54b4224)) (@Aenimus)

# [0.67.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.66.3...@wundergraph/cosmo-connect@0.67.0) (2024-04-26)

### Features

* add apollo compatibility mode in wgc federated-graph fetch command ([#742](https://github.com/wundergraph/cosmo/issues/742)) ([ecd73ab](https://github.com/wundergraph/cosmo/commit/ecd73ab91e1c8289008cae1062220826884d26e8)) (@JivusAyrus)

## [0.66.3](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.66.2...@wundergraph/cosmo-connect@0.66.3) (2024-04-17)

### Bug Fixes

* make sure an api key with no resources can not be created ([#728](https://github.com/wundergraph/cosmo/issues/728)) ([7717ff6](https://github.com/wundergraph/cosmo/commit/7717ff6a147c485683a3d26c9e8f3b98173e67ee)) (@JivusAyrus)

## [0.66.2](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.66.1...@wundergraph/cosmo-connect@0.66.2) (2024-04-12)

### Bug Fixes

* inform users if there is nothing new to publish ([#710](https://github.com/wundergraph/cosmo/issues/710)) ([faf01fc](https://github.com/wundergraph/cosmo/commit/faf01fc9e398ef70873abeec8eee06e797cbabf3)) (@JivusAyrus)

## [0.66.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.66.0...@wundergraph/cosmo-connect@0.66.1) (2024-04-10)

### Bug Fixes

* validate whether webhook exists ([#718](https://github.com/wundergraph/cosmo/issues/718)) ([81065d2](https://github.com/wundergraph/cosmo/commit/81065d20e4c47b66bf47edc3b590c9d6e217e046)) (@StarpTech)

# [0.66.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.65.0...@wundergraph/cosmo-connect@0.66.0) (2024-04-09)

### Features

* support edfs subscription stream/consumer; multiple subjects ([#685](https://github.com/wundergraph/cosmo/issues/685)) ([c70b2ae](https://github.com/wundergraph/cosmo/commit/c70b2aefd39c45b5f98eae8a3c43f639d56064b2)) (@Aenimus)

# [0.65.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.64.1...@wundergraph/cosmo-connect@0.65.0) (2024-04-03)

### Features

* implement scim server ([#664](https://github.com/wundergraph/cosmo/issues/664)) ([12591da](https://github.com/wundergraph/cosmo/commit/12591da32ef62e9498855ceda37beba72835a801)) (@)

### Features

* implement scim server ([#664](https://github.com/wundergraph/cosmo/issues/664)) ([12591da](https://github.com/wundergraph/cosmo/commit/12591da32ef62e9498855ceda37beba72835a801)) (@JivusAyrus)

## [0.64.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.64.0...@wundergraph/cosmo-connect@0.64.1) (2024-03-20)

### Bug Fixes

* proto fields ([#655](https://github.com/wundergraph/cosmo/issues/655)) ([e2c5909](https://github.com/wundergraph/cosmo/commit/e2c59090e0207325e423dc38e7b2a6cbae745508)) (@thisisnithin)

# [0.64.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.63.0...@wundergraph/cosmo-connect@0.64.0) (2024-03-20)

### Features

* monograph support ([#623](https://github.com/wundergraph/cosmo/issues/623)) ([a255f74](https://github.com/wundergraph/cosmo/commit/a255f747d63454e1219760b729d99e4778d56dda)) (@thisisnithin)

# [0.63.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.62.0...@wundergraph/cosmo-connect@0.63.0) (2024-03-18)

### Features

* allow to update admission url ([#638](https://github.com/wundergraph/cosmo/issues/638)) ([c7f7ee6](https://github.com/wundergraph/cosmo/commit/c7f7ee65f7716d463fb0bf96cf386e54ba5f8b73)) (@StarpTech)

# [0.62.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.61.0...@wundergraph/cosmo-connect@0.62.0) (2024-03-14)

### Features

* router config signature validation through custom admission webhooks ([#628](https://github.com/wundergraph/cosmo/issues/628)) ([384fd7e](https://github.com/wundergraph/cosmo/commit/384fd7e3372479e96fccc4fc771dc4e9f9c84754)) (@StarpTech)

# [0.61.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.60.0...@wundergraph/cosmo-connect@0.61.0) (2024-03-13)

### Features

* add edfs validation; add event source name keys to config ([#624](https://github.com/wundergraph/cosmo/issues/624)) ([bf03bb8](https://github.com/wundergraph/cosmo/commit/bf03bb8fca1838fefebcb150f8924ec52fb8bdb5)) (@Aenimus)

# [0.60.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.59.1...@wundergraph/cosmo-connect@0.60.0) (2024-03-11)

### Features

* add configurable schema linting ([#596](https://github.com/wundergraph/cosmo/issues/596)) ([c662485](https://github.com/wundergraph/cosmo/commit/c66248529c5bc13e795725c82ba50dbad79451ae)) (@JivusAyrus)

## [0.59.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.59.0...@wundergraph/cosmo-connect@0.59.1) (2024-03-08)

### Bug Fixes

* handle empty files in the cli itself ([#593](https://github.com/wundergraph/cosmo/issues/593)) ([de08e24](https://github.com/wundergraph/cosmo/commit/de08e24e63bc0083d3b86c417cb1bd282891c60b)) (@JivusAyrus)

# [0.59.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.58.0...@wundergraph/cosmo-connect@0.59.0) (2024-02-27)

### Features

* **cli:** new command to fetch latest published subgraph SDL ([#575](https://github.com/wundergraph/cosmo/issues/575)) ([09a0ab5](https://github.com/wundergraph/cosmo/commit/09a0ab54cccae6f46c1e585cf12fa9321f44e9ed)) (@StarpTech)
* show link to studio page on subgraph check ([#578](https://github.com/wundergraph/cosmo/issues/578)) ([701d81c](https://github.com/wundergraph/cosmo/commit/701d81c764b12bb1a2ec308634e69aaffb9e7e3e)) (@thisisnithin)

# [0.58.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.57.0...@wundergraph/cosmo-connect@0.58.0) (2024-02-20)

### Features

* implement slider for analytics duration ([#539](https://github.com/wundergraph/cosmo/issues/539)) ([3f4a0ee](https://github.com/wundergraph/cosmo/commit/3f4a0eeb58daa36ddf0be4bfc20959b53b6d0928)) (@JivusAyrus)

# [0.57.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.56.1...@wundergraph/cosmo-connect@0.57.0) (2024-02-20)

### Features

* support empty labels and label matchers ([#555](https://github.com/wundergraph/cosmo/issues/555)) ([8bb857c](https://github.com/wundergraph/cosmo/commit/8bb857c94f8165676b2ca5101c199f3bc0648d10)) (@thisisnithin)

## [0.56.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.56.0...@wundergraph/cosmo-connect@0.56.1) (2024-02-19)

### Bug Fixes

* don't expose token on wgc list command ([#550](https://github.com/wundergraph/cosmo/issues/550)) ([357ffae](https://github.com/wundergraph/cosmo/commit/357ffae4362c3c37dc955d40363da40cd985bf3f)) (@StarpTech)

# [0.56.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.55.1...@wundergraph/cosmo-connect@0.56.0) (2024-02-16)

### Features

* operation check overrides ([#516](https://github.com/wundergraph/cosmo/issues/516)) ([651ff8e](https://github.com/wundergraph/cosmo/commit/651ff8ed88cd542d56cf11d11086f659fc3f5d4e)) (@thisisnithin)

## [0.55.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.55.0...@wundergraph/cosmo-connect@0.55.1) (2024-02-13)

### Bug Fixes

* distinguish between server and process uptime, fix uptime ch query ([#520](https://github.com/wundergraph/cosmo/issues/520)) ([6fc2b72](https://github.com/wundergraph/cosmo/commit/6fc2b7237cd029127f6913199c40dd61bb16a22b)) (@StarpTech)

# [0.55.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.54.0...@wundergraph/cosmo-connect@0.55.0) (2024-02-13)

### Features

* router fleet management ([#515](https://github.com/wundergraph/cosmo/issues/515)) ([7f0deae](https://github.com/wundergraph/cosmo/commit/7f0deae98a2f58bd46927bdb2be8d615613b908f)) (@StarpTech)

# [0.54.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.53.0...@wundergraph/cosmo-connect@0.54.0) (2024-02-06)

### Features

* add pagination component and validate limit ([#493](https://github.com/wundergraph/cosmo/issues/493)) ([880f1b9](https://github.com/wundergraph/cosmo/commit/880f1b9f64167b70b7f61620ebb5a895d438727a)) (@JivusAyrus)

# [0.53.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.52.0...@wundergraph/cosmo-connect@0.53.0) (2024-02-01)

### Features

* integrate S3 when executing "getLatestValidRouterConfig" from the CLI ([#467](https://github.com/wundergraph/cosmo/issues/467)) ([90b7c8e](https://github.com/wundergraph/cosmo/commit/90b7c8ed01bdd659183c87cc2d94946ab20fe073)) (@JivusAyrus)

# [0.52.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.51.0...@wundergraph/cosmo-connect@0.52.0) (2024-01-31)

### Features

* cosmo ai, generate docs on publish ([#466](https://github.com/wundergraph/cosmo/issues/466)) ([033ff90](https://github.com/wundergraph/cosmo/commit/033ff9068716935a7d646adebcc0e2b776d0295d)) (@StarpTech)

# [0.51.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.50.0...@wundergraph/cosmo-connect@0.51.0) (2024-01-30)

### Features

* subgraph analytics page ([#455](https://github.com/wundergraph/cosmo/issues/455)) ([f7a65c7](https://github.com/wundergraph/cosmo/commit/f7a65c79611da2d7efc603ef7e5a5b2e194203c9)) (@JivusAyrus)

# [0.50.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.49.1...@wundergraph/cosmo-connect@0.50.0) (2024-01-30)

### Features

* implement authorization directives ([#448](https://github.com/wundergraph/cosmo/issues/448)) ([181d89d](https://github.com/wundergraph/cosmo/commit/181d89d8e7dbf8eb23cddfa0b6c91c840a2986b0)) (@Aenimus)

## [0.49.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.49.0...@wundergraph/cosmo-connect@0.49.1) (2024-01-29)

### Bug Fixes

* use graph id from token ([#463](https://github.com/wundergraph/cosmo/issues/463)) ([5582d00](https://github.com/wundergraph/cosmo/commit/5582d004c98eb20f62ecf2332b327c7959e5b64f)) (@thisisnithin)

# [0.49.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.48.0...@wundergraph/cosmo-connect@0.49.0) (2024-01-26)

### Features

* namespaces ([#447](https://github.com/wundergraph/cosmo/issues/447)) ([bbe5258](https://github.com/wundergraph/cosmo/commit/bbe5258c5e764c52947f831d3a7f1a2f93c267d4)) (@thisisnithin)

# [0.48.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.47.0...@wundergraph/cosmo-connect@0.48.0) (2024-01-26)

### Features

* produce spans for handler and engine work ([#456](https://github.com/wundergraph/cosmo/issues/456)) ([fd5ad67](https://github.com/wundergraph/cosmo/commit/fd5ad678c184c34e1f09ff2e89664c53894ae74c)) (@StarpTech)

# [0.47.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.46.0...@wundergraph/cosmo-connect@0.47.0) (2024-01-23)

### Features

* implement pagination and date filter for audit logs ([#444](https://github.com/wundergraph/cosmo/issues/444)) ([e014c08](https://github.com/wundergraph/cosmo/commit/e014c0896dd017cf4db6a2c5f2c2d83b1fc86017)) (@JivusAyrus)

# [0.46.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.45.0...@wundergraph/cosmo-connect@0.46.0) (2024-01-21)

### Features

* implement key resolvable false and implicit entities ([#445](https://github.com/wundergraph/cosmo/issues/445)) ([5685a43](https://github.com/wundergraph/cosmo/commit/5685a439c7a467e8f195948a5021a5511d91c870)) (@Aenimus)

# [0.45.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.44.0...@wundergraph/cosmo-connect@0.45.0) (2024-01-16)

### Features

* audit logs ([#424](https://github.com/wundergraph/cosmo/issues/424)) ([bb3aa46](https://github.com/wundergraph/cosmo/commit/bb3aa4632e28ed45c4fe1f8a0cc3e04acf0c194a)) (@StarpTech)

# [0.44.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.43.1...@wundergraph/cosmo-connect@0.44.0) (2024-01-09)

### Features

* add support of interface objects ([#407](https://github.com/wundergraph/cosmo/issues/407)) ([3d7b0e1](https://github.com/wundergraph/cosmo/commit/3d7b0e1f55fd8087945923a8e4f5e7d66f6b559a)) (@Aenimus)

## [0.43.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.43.0...@wundergraph/cosmo-connect@0.43.1) (2024-01-09)

### Bug Fixes

* discussion improvements ([#408](https://github.com/wundergraph/cosmo/issues/408)) ([dce1c48](https://github.com/wundergraph/cosmo/commit/dce1c480c6c8dac97ec6e5dd7491375d4c00b73f)) (@thisisnithin)

# [0.43.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.42.0...@wundergraph/cosmo-connect@0.43.0) (2024-01-08)

### Features

* discussions ([#394](https://github.com/wundergraph/cosmo/issues/394)) ([3d81052](https://github.com/wundergraph/cosmo/commit/3d810521e552b3146a4a4b2cb5a13285aceb4476)) (@thisisnithin)

# [0.42.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.41.0...@wundergraph/cosmo-connect@0.42.0) (2024-01-06)

### Features

* track subgraphs in metrics ([#405](https://github.com/wundergraph/cosmo/issues/405)) ([7b9f307](https://github.com/wundergraph/cosmo/commit/7b9f3074ea718d49135c5f46943002e37bef48e2)) (@StarpTech)

# [0.41.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.40.0...@wundergraph/cosmo-connect@0.41.0) (2023-12-28)

### Features

* billing and limit refactoring ([#371](https://github.com/wundergraph/cosmo/issues/371)) ([0adfee1](https://github.com/wundergraph/cosmo/commit/0adfee146017a10c6e787a08723ef4d03ddf0f96)) (@Pagebakers)

# [0.40.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.39.0...@wundergraph/cosmo-connect@0.40.0) (2023-12-22)

### Features

* add readme for subgraphs and federated graphs ([#384](https://github.com/wundergraph/cosmo/issues/384)) ([260ffac](https://github.com/wundergraph/cosmo/commit/260ffac99d5c81b82991d1261b937cf4fa344949)) (@JivusAyrus)

# [0.39.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.38.0...@wundergraph/cosmo-connect@0.39.0) (2023-12-19)

### Features

* add NATS to the router ([#333](https://github.com/wundergraph/cosmo/issues/333)) ([9c8303b](https://github.com/wundergraph/cosmo/commit/9c8303ba6d49a3dea682ff598210b2891a8dd29c)) (@fiam)

# [0.38.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.37.0...@wundergraph/cosmo-connect@0.38.0) (2023-12-15)

### Features

* add git commit sha to checks ([#361](https://github.com/wundergraph/cosmo/issues/361)) ([c9ef0c8](https://github.com/wundergraph/cosmo/commit/c9ef0c8439f89ffb80a4ed2f6c319a75414a07cf)) (@Pagebakers)

# [0.37.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.36.0...@wundergraph/cosmo-connect@0.37.0) (2023-12-12)

### Features

* add rbac for subgraphs and federated graphs ([#351](https://github.com/wundergraph/cosmo/issues/351)) ([72e39bc](https://github.com/wundergraph/cosmo/commit/72e39bc1ff914831499c0625e443ab2ec0af135c)) (@JivusAyrus)

# [0.36.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.35.0...@wundergraph/cosmo-connect@0.36.0) (2023-12-04)

### Bug Fixes

* invitations ([#326](https://github.com/wundergraph/cosmo/issues/326)) ([8915cd8](https://github.com/wundergraph/cosmo/commit/8915cd80ab20285b768fa8af8b02e1572d452a40)) (@JivusAyrus)

### Features

* add compositions page ([#325](https://github.com/wundergraph/cosmo/issues/325)) ([fb7a018](https://github.com/wundergraph/cosmo/commit/fb7a0180579872c486bd59b6b3adc9c19f8f302d)) (@JivusAyrus)

# [0.35.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.34.0...@wundergraph/cosmo-connect@0.35.0) (2023-12-01)

### Features

* persist ops from playground and view all client ops ([#323](https://github.com/wundergraph/cosmo/issues/323)) ([042d7db](https://github.com/wundergraph/cosmo/commit/042d7db00dbf2945a6be2b30e31d7851befc407b)) (@thisisnithin)
* restructure navigation ([#280](https://github.com/wundergraph/cosmo/issues/280)) ([df23357](https://github.com/wundergraph/cosmo/commit/df23357ceae0d7b37daf489a020f65777778e38b)) (@Pagebakers)

# [0.34.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.33.0...@wundergraph/cosmo-connect@0.34.0) (2023-11-30)

### Features

* register router on the controlplane ([#318](https://github.com/wundergraph/cosmo/issues/318)) ([10f86df](https://github.com/wundergraph/cosmo/commit/10f86dfebd80265d42015eaf3b9c15f941aef66b)) (@StarpTech)

# [0.33.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.32.0...@wundergraph/cosmo-connect@0.33.0) (2023-11-29)

### Bug Fixes

* invite flow rework ([c27f150](https://github.com/wundergraph/cosmo/commit/c27f15049fedff923b4bcb0f9e2effed874be408)) (@JivusAyrus)

### Features

* accept custom operation IDs for persisted operations ([#302](https://github.com/wundergraph/cosmo/issues/302)) ([a535a62](https://github.com/wundergraph/cosmo/commit/a535a62bb7f70d2e58d1a04066fb74e78d932653)) (@fiam)
* add new invitations table ([5d96c18](https://github.com/wundergraph/cosmo/commit/5d96c1807700d75fdf9c2a91dcf082170c5bc522)) (@JivusAyrus)

# [0.32.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.30.2...@wundergraph/cosmo-connect@0.32.0) (2023-11-23)

### Features

* add organization limits ([#285](https://github.com/wundergraph/cosmo/issues/285)) ([52a5664](https://github.com/wundergraph/cosmo/commit/52a566400dfa111a78a4bbdcf0a824dd2205da2d)) (@JivusAyrus)
* add support for persisted operations ([#249](https://github.com/wundergraph/cosmo/issues/249)) ([a9ad47f](https://github.com/wundergraph/cosmo/commit/a9ad47ff5cf7db6bccf774e168b1d1ce3ee7bcdd)) (@fiam)

# [0.31.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.30.2...@wundergraph/cosmo-connect@0.31.0) (2023-11-23)

### Features

* add organization limits ([#285](https://github.com/wundergraph/cosmo/issues/285)) ([52a5664](https://github.com/wundergraph/cosmo/commit/52a566400dfa111a78a4bbdcf0a824dd2205da2d)) (@JivusAyrus)
* add support for persisted operations ([#249](https://github.com/wundergraph/cosmo/issues/249)) ([a9ad47f](https://github.com/wundergraph/cosmo/commit/a9ad47ff5cf7db6bccf774e168b1d1ce3ee7bcdd)) (@fiam)

## [0.30.2](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.30.1...@wundergraph/cosmo-connect@0.30.2) (2023-11-20)

### Bug Fixes

* [connect] Move devDependencies to dependencies ([#273](https://github.com/wundergraph/cosmo/issues/273)) ([ee947ba](https://github.com/wundergraph/cosmo/commit/ee947ba12063ac59431f5c1e975ded7a90e932a1)) (@clayne11)

## [0.30.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.30.0...@wundergraph/cosmo-connect@0.30.1) (2023-11-17)

### Bug Fixes

* show latest valid subgraph schema ([#259](https://github.com/wundergraph/cosmo/issues/259)) ([d954b91](https://github.com/wundergraph/cosmo/commit/d954b91bd212ae1a33257c662a4ff8a2ac8c2b56)) (@JivusAyrus)

# [0.30.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.29.0...@wundergraph/cosmo-connect@0.30.0) (2023-11-15)

### Features

* consider input and argument usage for breaking change detection ([#255](https://github.com/wundergraph/cosmo/issues/255)) ([e10ac40](https://github.com/wundergraph/cosmo/commit/e10ac401f543f5540b5ada8f80533ddfbd0bc728)) (@jensneuse)

# [0.29.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.28.0...@wundergraph/cosmo-connect@0.29.0) (2023-11-15)

### Features

* add check for deleted subgraphs ([#258](https://github.com/wundergraph/cosmo/issues/258)) ([ba87fe5](https://github.com/wundergraph/cosmo/commit/ba87fe51631ece9c2efaea6350dc93590f1846c5)) (@Pagebakers)

# [0.28.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.27.0...@wundergraph/cosmo-connect@0.28.0) (2023-11-09)

### Bug Fixes

* minor issues of sso ([#247](https://github.com/wundergraph/cosmo/issues/247)) ([8bf61a9](https://github.com/wundergraph/cosmo/commit/8bf61a90751cf3b4aed3783cf07bab2560acac10)) (@JivusAyrus)

### Features

* link operations through hash ([#244](https://github.com/wundergraph/cosmo/issues/244)) ([24a7738](https://github.com/wundergraph/cosmo/commit/24a773884947c58183ee56bb9be82e2fae1c0bff)) (@thisisnithin)

# [0.27.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.26.0...@wundergraph/cosmo-connect@0.27.0) (2023-11-08)

### Features

* implement sso & basic RBAC in Cosmo ([#220](https://github.com/wundergraph/cosmo/issues/220)) ([55af35b](https://github.com/wundergraph/cosmo/commit/55af35b14068441d1df219599874a575dedb9dc2)) (@JivusAyrus)

# [0.26.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.25.0...@wundergraph/cosmo-connect@0.26.0) (2023-11-06)

### Features

* upgrade to stable connect & react-query 5 ([#231](https://github.com/wundergraph/cosmo/issues/231)) ([0c434eb](https://github.com/wundergraph/cosmo/commit/0c434eb41b357f596d19607cd2c8572f6a9899a1)) (@StarpTech)

# [0.25.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.24.0...@wundergraph/cosmo-connect@0.25.0) (2023-11-03)

### Bug Fixes

* date picker improvements ([#226](https://github.com/wundergraph/cosmo/issues/226)) ([9b784cf](https://github.com/wundergraph/cosmo/commit/9b784cf2180fb59f152ab9d8296e7026e1461c9c)) (@Pagebakers)

### Features

* add ranges to date picker ([#210](https://github.com/wundergraph/cosmo/issues/210)) ([3dac117](https://github.com/wundergraph/cosmo/commit/3dac1179b6e78f2bf2ee5f40c735463e96ef980d)) (@Pagebakers)
* operation checks (breaking change detection) ([#214](https://github.com/wundergraph/cosmo/issues/214)) ([0935413](https://github.com/wundergraph/cosmo/commit/093541305866327c5c44637603621e4a8053640d)) (@StarpTech)

# [0.24.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.23.0...@wundergraph/cosmo-connect@0.24.0) (2023-10-25)

### Features

* schema field level usage analytics ([#174](https://github.com/wundergraph/cosmo/issues/174)) ([4f257a7](https://github.com/wundergraph/cosmo/commit/4f257a71984e991be2304b09a083c69da65200d2)) (@StarpTech)

# [0.23.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.22.0...@wundergraph/cosmo-connect@0.23.0) (2023-10-23)

### Features

* allow to upsert a subgraph on publish ([#196](https://github.com/wundergraph/cosmo/issues/196)) ([27a1630](https://github.com/wundergraph/cosmo/commit/27a1630574e817412a6d5fb2b304da645a31d481)) (@StarpTech)

# [0.22.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.21.0...@wundergraph/cosmo-connect@0.22.0) (2023-10-20)

### Features

* add client name client version filter for analytics and ([#181](https://github.com/wundergraph/cosmo/issues/181)) ([6180f4d](https://github.com/wundergraph/cosmo/commit/6180f4d621c383e72883c3cfa10ac1119da91761)) (@Pagebakers)
* add support for subscriptions ([#185](https://github.com/wundergraph/cosmo/issues/185)) ([5a78aa0](https://github.com/wundergraph/cosmo/commit/5a78aa01f60ac4184ac69b0bd72aa1ce467bff93)) (@fiam)
* auto ignore schema errors for check command if github is integrated ([#184](https://github.com/wundergraph/cosmo/issues/184)) ([05d1b4a](https://github.com/wundergraph/cosmo/commit/05d1b4a4fcb836013c8db49796c174eba0c96744)) (@thisisnithin)

# [0.21.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.20.0...@wundergraph/cosmo-connect@0.21.0) (2023-10-13)

### Features

* implement slack notifications ([#175](https://github.com/wundergraph/cosmo/issues/175)) ([87c30ec](https://github.com/wundergraph/cosmo/commit/87c30ec86fcd7090b33cbf274bd126534992857f)) (@JivusAyrus)

# [0.20.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.19.0...@wundergraph/cosmo-connect@0.20.0) (2023-10-09)

### Bug Fixes

* ui improvements ([#170](https://github.com/wundergraph/cosmo/issues/170)) ([fffd3e2](https://github.com/wundergraph/cosmo/commit/fffd3e2b7d9a82e7b809214a7ce836cce83f54b9)) (@thisisnithin)

### Features

* use metric data for dashboard stats ([#169](https://github.com/wundergraph/cosmo/issues/169)) ([e25fe32](https://github.com/wundergraph/cosmo/commit/e25fe32cdc053d658b0b0cdcd819b039be3341e6)) (@StarpTech)

# [0.19.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.18.0...@wundergraph/cosmo-connect@0.19.0) (2023-10-06)

### Features

* display router initiation command ([#158](https://github.com/wundergraph/cosmo/issues/158)) ([284200b](https://github.com/wundergraph/cosmo/commit/284200b5ebae35a348fef1a650d268800f3887ac)) (@JivusAyrus)
* use clickhouse as metric storage ([#137](https://github.com/wundergraph/cosmo/issues/137)) ([c5e9bf4](https://github.com/wundergraph/cosmo/commit/c5e9bf4b74d32f3cae7da27b6170300c1a462e52)) (@StarpTech)

# [0.18.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.17.0...@wundergraph/cosmo-connect@0.18.0) (2023-10-05)

### Features

* configurable webhook events ([#149](https://github.com/wundergraph/cosmo/issues/149)) ([54836cc](https://github.com/wundergraph/cosmo/commit/54836cc5cb5a4fb46817ec04e82bfafaa134d59c)) (@thisisnithin)
* implement list and delete router tokens ([#146](https://github.com/wundergraph/cosmo/issues/146)) ([72543f7](https://github.com/wundergraph/cosmo/commit/72543f796c66d155782cd90bc4828803fbb971c7)) (@JivusAyrus)

# [0.17.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.16.0...@wundergraph/cosmo-connect@0.17.0) (2023-10-04)

### Features

* github app integration ([#140](https://github.com/wundergraph/cosmo/issues/140)) ([783a1f9](https://github.com/wundergraph/cosmo/commit/783a1f9c3f42284d1bf6cfa0d8fd46971724500a)) (@thisisnithin)

# [0.16.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.15.0...@wundergraph/cosmo-connect@0.16.0) (2023-09-29)

### Features

* implement leave and delete organization ([#112](https://github.com/wundergraph/cosmo/issues/112)) ([59bc44f](https://github.com/wundergraph/cosmo/commit/59bc44f53cbc72d492cf0e07e75d7e62e7c68b61)) (@JivusAyrus)
* improve trail version banner and handle trial version expiry ([#138](https://github.com/wundergraph/cosmo/issues/138)) ([0ecb2d1](https://github.com/wundergraph/cosmo/commit/0ecb2d150d9f9906631168aa0f588d2ca64ab590)) (@JivusAyrus)

# [0.15.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.14.0...@wundergraph/cosmo-connect@0.15.0) (2023-09-25)

### Features

* implement get changelog cli command ([#117](https://github.com/wundergraph/cosmo/issues/117)) ([ffaad09](https://github.com/wundergraph/cosmo/commit/ffaad093a212a6340263c4223452fb9edfec7570)) (@thisisnithin)

# [0.14.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.13.0...@wundergraph/cosmo-connect@0.14.0) (2023-09-25)

### Features

* advanced analytics ([#99](https://github.com/wundergraph/cosmo/issues/99)) ([a7a3058](https://github.com/wundergraph/cosmo/commit/a7a305851faa868d30dc202eef197afc6065ce92)) (@Pagebakers)

# [0.13.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.12.0...@wundergraph/cosmo-connect@0.13.0) (2023-09-21)

### Features

* changelog pagination ([#103](https://github.com/wundergraph/cosmo/issues/103)) ([614b57e](https://github.com/wundergraph/cosmo/commit/614b57ed4904dde04682e75ad80670f08f64b7b2)) (@thisisnithin)
* don't poll router config when config hasn't changed ([#105](https://github.com/wundergraph/cosmo/issues/105)) ([ea33961](https://github.com/wundergraph/cosmo/commit/ea339617a7d1724fd9b727953db5d591e50241dd)) (@StarpTech)

# [0.12.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.11.0...@wundergraph/cosmo-connect@0.12.0) (2023-09-20)

### Features

* store subgraphs in router config ([#61](https://github.com/wundergraph/cosmo/issues/61)) ([de7b132](https://github.com/wundergraph/cosmo/commit/de7b13244755acd49c38ff1e6c537234ab506960)) (@thisisnithin)

# [0.11.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.10.0...@wundergraph/cosmo-connect@0.11.0) (2023-09-16)

### Features

* only generate node api for router ([#76](https://github.com/wundergraph/cosmo/issues/76)) ([9307648](https://github.com/wundergraph/cosmo/commit/93076481437030fa6e348dccbc74591f91878f57)) (@StarpTech)
* webhooks ([#66](https://github.com/wundergraph/cosmo/issues/66)) ([dbb281f](https://github.com/wundergraph/cosmo/commit/dbb281fda114ddb6be309b3336d0668d705e7bc9)) (@thisisnithin)

# [0.10.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.9.0...@wundergraph/cosmo-connect@0.10.0) (2023-09-13)

### Features

* add user registration ([#57](https://github.com/wundergraph/cosmo/issues/57)) ([c1d1841](https://github.com/wundergraph/cosmo/commit/c1d184192511f015c4b33db91d7342a0bb35710e)) (@JivusAyrus)

# [0.9.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.8.1...@wundergraph/cosmo-connect@0.9.0) (2023-09-11)

### Features

* add introspect subgraph command ([#44](https://github.com/wundergraph/cosmo/issues/44)) ([bf376cd](https://github.com/wundergraph/cosmo/commit/bf376cd75382b16659efb670ea54494f691328aa)) (@JivusAyrus)
* introspect subgraphs in cli ([#53](https://github.com/wundergraph/cosmo/issues/53)) ([2bd9f95](https://github.com/wundergraph/cosmo/commit/2bd9f95cd3ac13e878a12ab526d575c9b1daf248)) (@JivusAyrus)

## [0.8.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.8.0...@wundergraph/cosmo-connect@0.8.1) (2023-09-06)

### Bug Fixes

* take variant name as input while migrating ([#40](https://github.com/wundergraph/cosmo/issues/40)) ([6ace9fc](https://github.com/wundergraph/cosmo/commit/6ace9fc93c246dce3fce641a2e274e93d99ae813)) (@JivusAyrus)

# [0.8.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.7.0...@wundergraph/cosmo-connect@0.8.0) (2023-09-06)

### Features

* add argument configuration ([#10](https://github.com/wundergraph/cosmo/issues/10)) ([48d909f](https://github.com/wundergraph/cosmo/commit/48d909f4de954c2401b557ed6a9f58915388f679)) (@Aenimus)
* add pagination and date range filter for schema checks ([#35](https://github.com/wundergraph/cosmo/issues/35)) ([e7bbc04](https://github.com/wundergraph/cosmo/commit/e7bbc04f76180cfe4210f173697f323b34650e41)) (@JivusAyrus)
* implement whoami cli command ([#33](https://github.com/wundergraph/cosmo/issues/33)) ([c920b25](https://github.com/wundergraph/cosmo/commit/c920b25ff4dc31cf9788b1590e3c89e4a33a3ac0)) (@StarpTech)
* move to new connectrpc packages ([#32](https://github.com/wundergraph/cosmo/issues/32)) ([4c8423b](https://github.com/wundergraph/cosmo/commit/4c8423bf377b63af6a42a42d7d5fc1ce2db1f09e)) (@StarpTech)

# [0.7.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.6.0...@wundergraph/cosmo-connect@0.7.0) (2023-08-31)

### Features

* migrate graphs from apollo ([#17](https://github.com/wundergraph/cosmo/issues/17)) ([0d9d025](https://github.com/wundergraph/cosmo/commit/0d9d025adadf11fd0516cbe10f470765757a9853)) (@JivusAyrus)

# [0.6.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.5.0...@wundergraph/cosmo-connect@0.6.0) (2023-08-28)

### Features

* add resend invitation and remove member/invitation functionality ([#2](https://github.com/wundergraph/cosmo/issues/2)) ([7528ba3](https://github.com/wundergraph/cosmo/commit/7528ba3f6456be40769ea314b3b36a26a10e852b)) (@JivusAyrus)

# 0.5.0 (2023-08-24)

### Features

* prepare release pipeline ([#3](https://github.com/wundergraph/cosmo/issues/3)) ([b6156fc](https://github.com/wundergraph/cosmo/commit/b6156fcf66254f08c3fba30f3987550ff121c3e5)) (@StarpTech)

## [0.4.2](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.3.0...@wundergraph/cosmo-connect@0.4.2) (2023-08-24)

**Note:** Version bump only for package @wundergraph/cosmo-connect

## [0.4.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/cosmo-connect@0.3.0...@wundergraph/cosmo-connect@0.4.1) (2023-08-24)

**Note:** Version bump only for package @wundergraph/cosmo-connect

# 0.4.0 (2023-08-24)

### Features

* prepare release pipeline ([#3](https://github.com/wundergraph/cosmo/issues/3)) ([b6156fc](https://github.com/wundergraph/cosmo/commit/b6156fcf66254f08c3fba30f3987550ff121c3e5)) (@StarpTech)

# 0.3.0 (2023-08-24)

### Features

* prepare release pipeline ([#3](https://github.com/wundergraph/cosmo/issues/3)) ([b6156fc](https://github.com/wundergraph/cosmo/commit/b6156fcf66254f08c3fba30f3987550ff121c3e5)) (@StarpTech)

# 0.2.0 (2023-08-24)

### Features

* prepare release pipeline ([#3](https://github.com/wundergraph/cosmo/issues/3)) ([b6156fc](https://github.com/wundergraph/cosmo/commit/b6156fcf66254f08c3fba30f3987550ff121c3e5)) (@StarpTech)

# 0.1.0 (2023-08-24)

### Features

* prepare release pipeline ([#3](https://github.com/wundergraph/cosmo/issues/3)) ([b6156fc](https://github.com/wundergraph/cosmo/commit/b6156fcf66254f08c3fba30f3987550ff121c3e5)) (@StarpTech)

# 0.1.0 (2023-08-24)

### Features

* prepare release pipeline ([#3](https://github.com/wundergraph/cosmo/issues/3)) ([b6156fc](https://github.com/wundergraph/cosmo/commit/b6156fcf66254f08c3fba30f3987550ff121c3e5)) (@StarpTech)
