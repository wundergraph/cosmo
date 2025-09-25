# Change Log
Binaries are attached to the github release otherwise all images can be found [here](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.253.1](https://github.com/wundergraph/cosmo/compare/router@0.253.0...router@0.253.1) (2025-09-25)

### Bug Fixes

* remove an index after _entities in errors path ([#2237](https://github.com/wundergraph/cosmo/issues/2237)) ([ad1818e](https://github.com/wundergraph/cosmo/commit/ad1818eb4364210345e6624336daf1335d776af9)) (@ysmolski)

# [0.253.0](https://github.com/wundergraph/cosmo/compare/router@0.252.3...router@0.253.0) (2025-09-25)

### Features

* validate optional "requires" fields ([#2230](https://github.com/wundergraph/cosmo/issues/2230)) ([8fe4967](https://github.com/wundergraph/cosmo/commit/8fe4967f0c700677c2ca37fa212f57769ba951e4)) (@ysmolski)

## [0.252.3](https://github.com/wundergraph/cosmo/compare/router@0.252.2...router@0.252.3) (2025-09-24)

### Bug Fixes

* **router:** high subscription loads causing deadlocks ([#2223](https://github.com/wundergraph/cosmo/issues/2223)) ([ff8bfa3](https://github.com/wundergraph/cosmo/commit/ff8bfa38f2d245ab884ce44152a2bbeaaa717118)) (@endigma)

## [0.252.2](https://github.com/wundergraph/cosmo/compare/router@0.252.1...router@0.252.2) (2025-09-23)

### Bug Fixes

* jwt validation blocks on multiple requests ([#2216](https://github.com/wundergraph/cosmo/issues/2216)) ([2d5a02a](https://github.com/wundergraph/cosmo/commit/2d5a02ad8e3e59a8429d9b1cd1071a5e5c605562)) (@SkArchon)

## [0.252.1](https://github.com/wundergraph/cosmo/compare/router@0.252.0...router@0.252.1) (2025-09-12)

### Bug Fixes

* fix detecting requires on interface members for abstract selection rewriter ([#2209](https://github.com/wundergraph/cosmo/issues/2209)) ([aeb0cd3](https://github.com/wundergraph/cosmo/commit/aeb0cd3202266d31c721988944b4e71f3807dbf2)) (@devsergiy)

# [0.252.0](https://github.com/wundergraph/cosmo/compare/router@0.251.1...router@0.252.0) (2025-09-12)

### Features

* send to subgraphs the "fetch_reasons" extension ([#2160](https://github.com/wundergraph/cosmo/issues/2160)) ([cd6f827](https://github.com/wundergraph/cosmo/commit/cd6f82738e6950969b0912374d0360b935345800)) (@ysmolski)

## [0.251.1](https://github.com/wundergraph/cosmo/compare/router@0.251.0...router@0.251.1) (2025-09-10)

### Bug Fixes

* connection stats being enabled break subscriptions ([#2203](https://github.com/wundergraph/cosmo/issues/2203)) ([64f87e6](https://github.com/wundergraph/cosmo/commit/64f87e665a0b36af8af392fcc41eef36f89635af)) (@SkArchon)

# [0.251.0](https://github.com/wundergraph/cosmo/compare/router@0.250.0...router@0.251.0) (2025-09-10)

### Features

* implement openfed__requireFetchReasons ([#2170](https://github.com/wundergraph/cosmo/issues/2170)) ([cfb097f](https://github.com/wundergraph/cosmo/commit/cfb097fb6ccc29a81cfca55fec6b71fdf6e1b61c)) (@Aenimus)

# [0.250.0](https://github.com/wundergraph/cosmo/compare/router@0.249.0...router@0.250.0) (2025-09-06)

### Features

* demo_mode should work also when no graph api token is set ([#2185](https://github.com/wundergraph/cosmo/issues/2185)) ([cad81fc](https://github.com/wundergraph/cosmo/commit/cad81fcb14087fdf25100d0bc585f57d7115cabf)) (@alepane21)
* upgrade all components to go 1.25 ([#2187](https://github.com/wundergraph/cosmo/issues/2187)) ([49c35ed](https://github.com/wundergraph/cosmo/commit/49c35ede5ab5873ee163815a047797429a63e3d1)) (@miklosbarabas)

# [0.249.0](https://github.com/wundergraph/cosmo/compare/router@0.248.0...router@0.249.0) (2025-09-03)

### Features

* **router:** block/disable persisted operations ([#2181](https://github.com/wundergraph/cosmo/issues/2181)) ([24fafa7](https://github.com/wundergraph/cosmo/commit/24fafa7e3b5f6975725963ba48c9e1dce359544f)) (@endigma)

# [0.248.0](https://github.com/wundergraph/cosmo/compare/router@0.247.0...router@0.248.0) (2025-09-03)

### Bug Fixes

* bug where query clone params are assigned to claim params ([#2184](https://github.com/wundergraph/cosmo/issues/2184)) ([6375c4b](https://github.com/wundergraph/cosmo/commit/6375c4b0d757f6663cce0debf3b3e12c8427a808)) (@SkArchon)

### Features

* add timings per client fetch for GraphQL http ([#2183](https://github.com/wundergraph/cosmo/issues/2183)) ([7c764de](https://github.com/wundergraph/cosmo/commit/7c764de2a0ecc95e3fc3e86555f775250a774221)) (@SkArchon)
* engine order header ordering for regex configurations ([#2180](https://github.com/wundergraph/cosmo/issues/2180)) ([0f15d1e](https://github.com/wundergraph/cosmo/commit/0f15d1e1364904d7c5be1f86749a8d1ae4c6562a)) (@SkArchon)

# [0.247.0](https://github.com/wundergraph/cosmo/compare/router@0.246.2...router@0.247.0) (2025-08-28)

### Features

* add span for each grpc invocation ([#2158](https://github.com/wundergraph/cosmo/issues/2158)) ([4f0383f](https://github.com/wundergraph/cosmo/commit/4f0383f780371b0f3549f94a2e85312178f0dfaa)) (@SkArchon)
* expression support for retry condition ([#2167](https://github.com/wundergraph/cosmo/issues/2167)) ([c1236f5](https://github.com/wundergraph/cosmo/commit/c1236f587fa4e623e965b241a56559edf1c55025)) (@StarpTech)
* **router:** improved heartbeats for subscriptions ([#2141](https://github.com/wundergraph/cosmo/issues/2141)) ([ca1861b](https://github.com/wundergraph/cosmo/commit/ca1861baa52df152824b8892366568e6384e507f)) (@endigma)

## [0.246.2](https://github.com/wundergraph/cosmo/compare/router@0.246.1...router@0.246.2) (2025-08-26)

### Bug Fixes

* don't log graceful watcher shutdown as error ([#2168](https://github.com/wundergraph/cosmo/issues/2168)) ([52804d3](https://github.com/wundergraph/cosmo/commit/52804d3749980148dc87ea7fc0ad3f7c6cb2cf42)) (@endigma)

## [0.246.1](https://github.com/wundergraph/cosmo/compare/router@0.246.0...router@0.246.1) (2025-08-24)

### Bug Fixes

* **cli:** fix link in plugin docs and npm workspace issue ([#2164](https://github.com/wundergraph/cosmo/issues/2164)) ([1a6b4f2](https://github.com/wundergraph/cosmo/commit/1a6b4f26063e6d8a642d68b0f96963367a592dfb)) (@StarpTech)

# [0.246.0](https://github.com/wundergraph/cosmo/compare/router@0.245.0...router@0.246.0) (2025-08-21)

### Features

* **mcp:** streamable HTTP support ([#2157](https://github.com/wundergraph/cosmo/issues/2157)) ([adf9d03](https://github.com/wundergraph/cosmo/commit/adf9d039e3661de3a167f4a73644676160fc115b)) (@StarpTech)

# [0.245.0](https://github.com/wundergraph/cosmo/compare/router@0.244.0...router@0.245.0) (2025-08-20)

### Features

* **router:** more intuitive subgraph traffic shaping config inheritance ([#2155](https://github.com/wundergraph/cosmo/issues/2155)) ([c922e10](https://github.com/wundergraph/cosmo/commit/c922e1071d120f773b6143998128c08f8a51aa1a)) (@endigma)

# [0.244.0](https://github.com/wundergraph/cosmo/compare/router@0.243.1...router@0.244.0) (2025-08-19)

### Features

* edfs stream metrics ([#2137](https://github.com/wundergraph/cosmo/issues/2137)) ([49df81f](https://github.com/wundergraph/cosmo/commit/49df81f9cf48366dcfb3393cdf4c8be98f24bbf9)) (@SkArchon)
* option to redact query param variables in access logs ([#2130](https://github.com/wundergraph/cosmo/issues/2130)) ([49637ab](https://github.com/wundergraph/cosmo/commit/49637abd0af0ea9cdf00d74f97969eba194afff8)) (@SkArchon)

## [0.243.1](https://github.com/wundergraph/cosmo/compare/router@0.243.0...router@0.243.1) (2025-08-15)

### Bug Fixes

* **router:** record operation planning time correctly in plan error case ([#2070](https://github.com/wundergraph/cosmo/issues/2070)) ([efbd9f6](https://github.com/wundergraph/cosmo/commit/efbd9f650b620d714a2fea1683b447c7bb5ca36d)) (@endigma)

# [0.243.0](https://github.com/wundergraph/cosmo/compare/router@0.242.0...router@0.243.0) (2025-08-13)

### Features

* always rewrite abstract fragments for gRPC ([#2133](https://github.com/wundergraph/cosmo/issues/2133)) ([65f53d4](https://github.com/wundergraph/cosmo/commit/65f53d439a46e11437f045f735f90a7535a9719f)) (@ysmolski)

# [0.242.0](https://github.com/wundergraph/cosmo/compare/router@0.241.0...router@0.242.0) (2025-08-12)

### Features

* add support for plugins ([#2079](https://github.com/wundergraph/cosmo/issues/2079)) ([05c923a](https://github.com/wundergraph/cosmo/commit/05c923aaa09a898a1662fc40d0e5751dfa5b8fe1)) (@JivusAyrus)

# [0.241.0](https://github.com/wundergraph/cosmo/compare/router@0.240.3...router@0.241.0) (2025-08-08)

### Features

* improve handling for entities with multiple keys ([#2123](https://github.com/wundergraph/cosmo/issues/2123)) ([5e1e6e8](https://github.com/wundergraph/cosmo/commit/5e1e6e82785b685e143c8962f41fe1062bf05207)) (@Noroth)

## [0.240.3](https://github.com/wundergraph/cosmo/compare/router@0.240.2...router@0.240.3) (2025-08-07)

### Bug Fixes

* fix rewriting an interface object implementing interface ([#2120](https://github.com/wundergraph/cosmo/issues/2120)) ([627d542](https://github.com/wundergraph/cosmo/commit/627d542d2797999fb03de83e54b973fa86ddbf63)) (@devsergiy)

## [0.240.2](https://github.com/wundergraph/cosmo/compare/router@0.240.1...router@0.240.2) (2025-08-06)

### Bug Fixes

* dont try to load operation when dir is empty ([#2101](https://github.com/wundergraph/cosmo/issues/2101)) ([a3b3fc2](https://github.com/wundergraph/cosmo/commit/a3b3fc2021baa051adbb6e129b32ce049ae0fbc5)) (@StarpTech)
* generate plans for subscriptions ([#2097](https://github.com/wundergraph/cosmo/issues/2097)) ([589d43b](https://github.com/wundergraph/cosmo/commit/589d43bb2879397f71e832fedb6b9d72e282dd07)) (@ysmolski)
* plan generator ignores the skip/include directives ([#2113](https://github.com/wundergraph/cosmo/issues/2113)) ([c935d14](https://github.com/wundergraph/cosmo/commit/c935d142e78f8515543da272ce6c66d620643c88)) (@ysmolski)

## [0.240.1](https://github.com/wundergraph/cosmo/compare/router@0.240.0...router@0.240.1) (2025-08-04)

### Bug Fixes

* skip hardcoded propagation ([#2106](https://github.com/wundergraph/cosmo/issues/2106)) ([bdd1ab3](https://github.com/wundergraph/cosmo/commit/bdd1ab32e2bd6326250b6734f5666cc2bdacd1d3)) (@SkArchon)

# [0.240.0](https://github.com/wundergraph/cosmo/compare/router@0.239.4...router@0.240.0) (2025-08-04)

### Features

* otel support for grpc plugins ([#2021](https://github.com/wundergraph/cosmo/issues/2021)) ([f7861a2](https://github.com/wundergraph/cosmo/commit/f7861a2d5099896ba6f5b3a29d9d087d58502987)) (@SkArchon)

## [0.239.4](https://github.com/wundergraph/cosmo/compare/router@0.239.3...router@0.239.4) (2025-07-31)

### Bug Fixes

* ensure subgraph operation name is unique ([#2094](https://github.com/wundergraph/cosmo/issues/2094)) ([0f47c69](https://github.com/wundergraph/cosmo/commit/0f47c69f269933691818ea5741995ce41a46783e)) (@ysmolski)

## [0.239.3](https://github.com/wundergraph/cosmo/compare/router@0.239.2...router@0.239.3) (2025-07-31)

### Bug Fixes

* block based on query operation name length ([#2090](https://github.com/wundergraph/cosmo/issues/2090)) ([3d924a4](https://github.com/wundergraph/cosmo/commit/3d924a4581f3dc96795a7781ccc46fd13c4c71a3)) (@SkArchon)

## [0.239.2](https://github.com/wundergraph/cosmo/compare/router@0.239.1...router@0.239.2) (2025-07-29)

### Bug Fixes

* fix parent node jump lookup ([#2091](https://github.com/wundergraph/cosmo/issues/2091)) ([b5c25de](https://github.com/wundergraph/cosmo/commit/b5c25de00de51d57c2fa112316d40cc92dfd6903)) (@devsergiy)

## [0.239.1](https://github.com/wundergraph/cosmo/compare/router@0.239.0...router@0.239.1) (2025-07-29)

### Bug Fixes

* impose limit on origin length when CORS is enabled with a wildcard ([#2085](https://github.com/wundergraph/cosmo/issues/2085)) ([ec71bd4](https://github.com/wundergraph/cosmo/commit/ec71bd42d9fa8f654f272d7a9c91bdd7113b37d9)) (@endigma)
* **router:** check persisted ops hashes to be well-formed ([#2078](https://github.com/wundergraph/cosmo/issues/2078)) ([5f0a0b8](https://github.com/wundergraph/cosmo/commit/5f0a0b8b1804ff3974ed7c5582aa61dd6a378e73)) (@ysmolski)

# [0.239.0](https://github.com/wundergraph/cosmo/compare/router@0.238.0...router@0.239.0) (2025-07-29)

### Features

* handle nested and nullable lists ([#2088](https://github.com/wundergraph/cosmo/issues/2088)) ([7fe14fb](https://github.com/wundergraph/cosmo/commit/7fe14fb70cbe1d6b1374621edf547903390c63c9)) (@Noroth)

# [0.238.0](https://github.com/wundergraph/cosmo/compare/router@0.237.0...router@0.238.0) (2025-07-28)

### Features

* add audience validation ([#2074](https://github.com/wundergraph/cosmo/issues/2074)) ([6ae66c8](https://github.com/wundergraph/cosmo/commit/6ae66c83cbf6129f2fa91c83a58cd7900c4906dc)) (@SkArchon)

# [0.237.0](https://github.com/wundergraph/cosmo/compare/router@0.236.0...router@0.237.0) (2025-07-25)

### Bug Fixes

* ip anonymization hash implementation ([#2080](https://github.com/wundergraph/cosmo/issues/2080)) ([40eaea2](https://github.com/wundergraph/cosmo/commit/40eaea27be93449a8d32611e16561ddd9c1ae3c8)) (@endigma)
* **router:** file mode duplicated prefix ([#2084](https://github.com/wundergraph/cosmo/issues/2084)) ([2b0e18d](https://github.com/wundergraph/cosmo/commit/2b0e18d2ddc303bdd58d1b0b1b61752b6cdc2bda)) (@Noroth)

### Features

* ability to configure the min size for response compression ([#2060](https://github.com/wundergraph/cosmo/issues/2060)) ([455fb0d](https://github.com/wundergraph/cosmo/commit/455fb0d9ead74954933273c1f6d39d3ceeafac3a)) (@mrpahdan)

# [0.236.0](https://github.com/wundergraph/cosmo/compare/router@0.235.3...router@0.236.0) (2025-07-24)

### Bug Fixes

* improve gzip request decompression middleware ([#2077](https://github.com/wundergraph/cosmo/issues/2077)) ([c8a12ef](https://github.com/wundergraph/cosmo/commit/c8a12ef4aa62c24e86e22310f98d7b0087d18e59)) (@endigma)
* json schema ([#2082](https://github.com/wundergraph/cosmo/issues/2082)) ([c7b4cf5](https://github.com/wundergraph/cosmo/commit/c7b4cf5d004c2786f59f41017414361fad229499)) (@devsergiy)

### Features

* **router:** make filemode configurable for access log files ([#2081](https://github.com/wundergraph/cosmo/issues/2081)) ([6b3d78e](https://github.com/wundergraph/cosmo/commit/6b3d78e900d4e07a8c72f1e211e8ee9921b742f0)) (@Noroth)
* support symmetric key algorithms for JWKs ([#2067](https://github.com/wundergraph/cosmo/issues/2067)) ([9bbdfbb](https://github.com/wundergraph/cosmo/commit/9bbdfbbb4a758f0b026ce13e8bd6f8ddad6b61b2)) (@SkArchon)

## [0.235.3](https://github.com/wundergraph/cosmo/compare/router@0.235.2...router@0.235.3) (2025-07-22)

### Bug Fixes

* planner fixes for parent entity jumps and unique nodes selections ([#2044](https://github.com/wundergraph/cosmo/issues/2044)) ([3c54a59](https://github.com/wundergraph/cosmo/commit/3c54a59970f808bba15c9e59fddde610c54c63ca)) (@devsergiy)

## [0.235.2](https://github.com/wundergraph/cosmo/compare/router@0.235.1...router@0.235.2) (2025-07-22)

### Bug Fixes

* enforce parser limits ([#2068](https://github.com/wundergraph/cosmo/issues/2068)) ([94b2971](https://github.com/wundergraph/cosmo/commit/94b29711c5840d222b932e48950d1723e66efb41)) (@devsergiy)
* fix merging inline fragment and field selections together ([#2073](https://github.com/wundergraph/cosmo/issues/2073)) ([cad2a35](https://github.com/wundergraph/cosmo/commit/cad2a350037939498d00e598060faee89f595b05)) (@ysmolski)

## [0.235.1](https://github.com/wundergraph/cosmo/compare/router@0.235.0...router@0.235.1) (2025-07-21)

### Bug Fixes

* **router:** provide request context of original WebSocket Upgrade request to subgraph requests ([#1957](https://github.com/wundergraph/cosmo/issues/1957)) ([b4420a1](https://github.com/wundergraph/cosmo/commit/b4420a1985b9f3999ce319ef877307677f8e6851)) (@DerZade)

# [0.235.0](https://github.com/wundergraph/cosmo/compare/router@0.234.0...router@0.235.0) (2025-07-17)

### Features

* **router:** add nonroot router docker image ([#2006](https://github.com/wundergraph/cosmo/issues/2006)) ([43c8912](https://github.com/wundergraph/cosmo/commit/43c89122fb5e12da903632c6bf0537952cc9d4b5)) (@obeaudet-ueat)

# [0.234.0](https://github.com/wundergraph/cosmo/compare/router@0.233.0...router@0.234.0) (2025-07-16)

### Bug Fixes

* fix merging fetches and add dependencies update ([#2053](https://github.com/wundergraph/cosmo/issues/2053)) ([29d2b7b](https://github.com/wundergraph/cosmo/commit/29d2b7b942c5b1dc250876ba6acb798dc105c52e)) (@devsergiy)
* security updates ([#2036](https://github.com/wundergraph/cosmo/issues/2036)) ([10f2e5f](https://github.com/wundergraph/cosmo/commit/10f2e5f9c79e6f492c84a5c65c2ae9cbd7776dba)) (@SkArchon)

### Features

* add Variables to OperationContext ([#2045](https://github.com/wundergraph/cosmo/issues/2045)) ([1919009](https://github.com/wundergraph/cosmo/commit/1919009cc2c7b916687a54dc0c15148293f14cb9)) (@alepane21)
* support nullable types and composite types ([#2047](https://github.com/wundergraph/cosmo/issues/2047)) ([4c418b7](https://github.com/wundergraph/cosmo/commit/4c418b758ddd4f62021ff362749872b7eb94ee2e)) (@Noroth)

# [0.233.0](https://github.com/wundergraph/cosmo/compare/router@0.232.1...router@0.233.0) (2025-07-10)

### Features

* **router:** option to allow all error extensions ([#2026](https://github.com/wundergraph/cosmo/issues/2026)) ([8fa9c45](https://github.com/wundergraph/cosmo/commit/8fa9c4529d5e541ce4b7cf29cfa778227120eff4)) (@endigma)

## [0.232.1](https://github.com/wundergraph/cosmo/compare/router@0.232.0...router@0.232.1) (2025-07-10)

### Bug Fixes

* enable input value deprecation in introspection query ([#2030](https://github.com/wundergraph/cosmo/issues/2030)) ([d53e9d6](https://github.com/wundergraph/cosmo/commit/d53e9d678b655cc178ee3c14888ff1ea45df23ec)) (@JivusAyrus)

# [0.232.0](https://github.com/wundergraph/cosmo/compare/router@0.231.1...router@0.232.0) (2025-07-09)

### Bug Fixes

* return parser error on empty selectionSet ([#2031](https://github.com/wundergraph/cosmo/issues/2031)) ([35d5211](https://github.com/wundergraph/cosmo/commit/35d5211d2c5e1eb226b47f2fc3e542904040d53f)) (@jensneuse)

### Features

* allow to log response payload and fix feature flag expression bug ([#2004](https://github.com/wundergraph/cosmo/issues/2004)) ([7000599](https://github.com/wundergraph/cosmo/commit/70005997db17607283e2db6d4612599ca35b72ac)) (@SkArchon)

## [0.231.1](https://github.com/wundergraph/cosmo/compare/router@0.231.0...router@0.231.1) (2025-07-09)

### Bug Fixes

* update plan generator default log level to `warn` from `warning` ([#2029](https://github.com/wundergraph/cosmo/issues/2029)) ([f15d994](https://github.com/wundergraph/cosmo/commit/f15d99405da12ac5de15f774be9daf7498e210bf)) (@endigma)

# [0.231.0](https://github.com/wundergraph/cosmo/compare/router@0.230.1...router@0.231.0) (2025-07-09)

### Bug Fixes

* `log_level` config schema to align with parse behaviour ([#2025](https://github.com/wundergraph/cosmo/issues/2025)) ([12e2b9e](https://github.com/wundergraph/cosmo/commit/12e2b9ecbd016ba8593d760f541860418da3caef)) (@endigma)

### Features

* add field dependencies to query plan ([#2027](https://github.com/wundergraph/cosmo/issues/2027)) ([06b19b8](https://github.com/wundergraph/cosmo/commit/06b19b881672ee79ef193b5bc65cb13c38c19711)) (@jensneuse)

## [0.230.1](https://github.com/wundergraph/cosmo/compare/router@0.230.0...router@0.230.1) (2025-07-07)

### Bug Fixes

* astparser/lexer fixes ([#2020](https://github.com/wundergraph/cosmo/issues/2020)) ([08a7037](https://github.com/wundergraph/cosmo/commit/08a703762c395719e052cfb7a78b804c6f404ab6)) (@devsergiy)

# [0.230.0](https://github.com/wundergraph/cosmo/compare/router@0.229.1...router@0.230.0) (2025-07-07)

### Features

* circuit breaker implementation ([#1929](https://github.com/wundergraph/cosmo/issues/1929)) ([c63f83b](https://github.com/wundergraph/cosmo/commit/c63f83b6ad5cfbba8444d4dc34de46d9bf7f187f)) (@SkArchon)

## [0.229.1](https://github.com/wundergraph/cosmo/compare/router@0.229.0...router@0.229.1) (2025-07-04)

### Bug Fixes

* fix collecting representation for fetches scoped to concrete types ([#2017](https://github.com/wundergraph/cosmo/issues/2017)) ([bc9bb36](https://github.com/wundergraph/cosmo/commit/bc9bb364cdf414ac6d884ca97b473494c332db6b)) (@devsergiy)

# [0.229.0](https://github.com/wundergraph/cosmo/compare/router@0.228.0...router@0.229.0) (2025-07-04)

### Features

* option to force disable persisted operations ([#2007](https://github.com/wundergraph/cosmo/issues/2007)) ([68db6bb](https://github.com/wundergraph/cosmo/commit/68db6bbb277156d583483683c16d62e9435103c0)) (@endigma)

# [0.228.0](https://github.com/wundergraph/cosmo/compare/router@0.227.1...router@0.228.0) (2025-07-03)

### Features

* configurable cardinality limit for otel ([#2009](https://github.com/wundergraph/cosmo/issues/2009)) ([71dfdcf](https://github.com/wundergraph/cosmo/commit/71dfdcf685cfd5b97f3bcd2fe7a34e4f8ecf0228)) (@endigma)

## [0.227.1](https://github.com/wundergraph/cosmo/compare/router@0.227.0...router@0.227.1) (2025-07-03)

### Bug Fixes

* **router:** require presence of prefix value for auth header ([#2011](https://github.com/wundergraph/cosmo/issues/2011)) ([bd25547](https://github.com/wundergraph/cosmo/commit/bd25547b96dc47af26061e6de9c9170e359f4fbc)) (@ysmolski)

# [0.227.0](https://github.com/wundergraph/cosmo/compare/router@0.226.2...router@0.227.0) (2025-07-03)

### Features

* status code derived fallback errors ([#2000](https://github.com/wundergraph/cosmo/issues/2000)) ([ea2fd12](https://github.com/wundergraph/cosmo/commit/ea2fd12ae65b7c4e4041bee366598ffd3e139a92)) (@endigma)

## [0.226.2](https://github.com/wundergraph/cosmo/compare/router@0.226.1...router@0.226.2) (2025-07-02)

### Bug Fixes

* fix checking presence of type fragment mapped to interface object ([#2001](https://github.com/wundergraph/cosmo/issues/2001)) ([79bdd2f](https://github.com/wundergraph/cosmo/commit/79bdd2f449fcbaeb2068a3aedb0a5cc81c222deb)) (@devsergiy)
* **router:** preserve HTTP status in WriteResponseError ([#1988](https://github.com/wundergraph/cosmo/issues/1988)) ([2647f84](https://github.com/wundergraph/cosmo/commit/2647f8498a8d41ace57410c69636e3c7975f60fb)) (@kaialang)

## [0.226.1](https://github.com/wundergraph/cosmo/compare/router@0.226.0...router@0.226.1) (2025-06-28)

### Bug Fixes

* fix rewriting object selections with nested abstract fragments ([#1994](https://github.com/wundergraph/cosmo/issues/1994)) ([1ee141e](https://github.com/wundergraph/cosmo/commit/1ee141e74ec20f453c30b5a49ddd446ab2cf3652)) (@devsergiy)

# [0.226.0](https://github.com/wundergraph/cosmo/compare/router@0.225.0...router@0.226.0) (2025-06-26)

### Features

* add redis pubsub support to EDFS ([#1810](https://github.com/wundergraph/cosmo/issues/1810)) ([8f294b6](https://github.com/wundergraph/cosmo/commit/8f294b62c14e9cae7e1ad85e65b0ca3ada0bcfbb)) (@alepane21)

# [0.225.0](https://github.com/wundergraph/cosmo/compare/router@0.224.0...router@0.225.0) (2025-06-25)

### Features

* add debounce to watcher ([#1976](https://github.com/wundergraph/cosmo/issues/1976)) ([5fd7f13](https://github.com/wundergraph/cosmo/commit/5fd7f13405c1b6135d93098d11cd21ae64c8c7c8)) (@SkArchon)
* add support for remote grpc services ([#1953](https://github.com/wundergraph/cosmo/issues/1953)) ([5074af9](https://github.com/wundergraph/cosmo/commit/5074af9ab4ce14c418fa8fee69e785fb6237f785)) (@Noroth)

# [0.224.0](https://github.com/wundergraph/cosmo/compare/router@0.223.0...router@0.224.0) (2025-06-19)

### Features

* expose query plan information to custom modules + bump engine ([#1979](https://github.com/wundergraph/cosmo/issues/1979)) ([027a504](https://github.com/wundergraph/cosmo/commit/027a5040882322d50562a697d56561916c95a52d)) (@endigma)

# [0.223.0](https://github.com/wundergraph/cosmo/compare/router@0.222.3...router@0.223.0) (2025-06-19)

### Features

* add SASL-SCRAM support and add logging of kafka client errors ([#1975](https://github.com/wundergraph/cosmo/issues/1975)) ([6b15a37](https://github.com/wundergraph/cosmo/commit/6b15a37183dfca7fe4c0b50f98956d20f599ae2f)) (@alepane21)

## [0.222.3](https://github.com/wundergraph/cosmo/compare/router@0.222.2...router@0.222.3) (2025-06-18)

### Bug Fixes

* cleanup flaky line for router build test ([#1974](https://github.com/wundergraph/cosmo/issues/1974)) ([616a5b5](https://github.com/wundergraph/cosmo/commit/616a5b59bd57301357c85dc48ca81d8cf0b778d5)) (@SkArchon)
* don't send complete when router shuts down ([#1956](https://github.com/wundergraph/cosmo/issues/1956)) ([882ac82](https://github.com/wundergraph/cosmo/commit/882ac82a9db0656c68ad4121970e95f949a8c182)) (@endigma)

## [0.222.2](https://github.com/wundergraph/cosmo/compare/router@0.222.1...router@0.222.2) (2025-06-17)

### Bug Fixes

* let netpoll handle closing websockets ([#1955](https://github.com/wundergraph/cosmo/issues/1955)) ([e5c2f95](https://github.com/wundergraph/cosmo/commit/e5c2f95b8c30971e59e1c847b2a343bdc46bafbb)) (@endigma)

## [0.222.1](https://github.com/wundergraph/cosmo/compare/router@0.222.0...router@0.222.1) (2025-06-16)

### Bug Fixes

* handling nested abstract fragments in abstract fragments ([#1964](https://github.com/wundergraph/cosmo/issues/1964)) ([8e86f54](https://github.com/wundergraph/cosmo/commit/8e86f544b202346b201928228b9b5e08321a0c4f)) (@devsergiy)

# [0.222.0](https://github.com/wundergraph/cosmo/compare/router@0.221.0...router@0.222.0) (2025-06-12)

### Features

* update engine: prefer newest websocket protocol, extend custom value renderer field value ([#1958](https://github.com/wundergraph/cosmo/issues/1958)) ([7aaea34](https://github.com/wundergraph/cosmo/commit/7aaea347276053d0aa72d8a48ab6d78ddc971f7b)) (@devsergiy)

# [0.221.0](https://github.com/wundergraph/cosmo/compare/router@0.220.0...router@0.221.0) (2025-06-12)

### Features

* allow for loading of multiple configurations ([#1950](https://github.com/wundergraph/cosmo/issues/1950)) ([54bfd62](https://github.com/wundergraph/cosmo/commit/54bfd62b6f4131277a24b3bdfb099f3a01c4553a)) (@SkArchon)

# [0.220.0](https://github.com/wundergraph/cosmo/compare/router@0.219.3...router@0.220.0) (2025-06-11)

### Bug Fixes

* babel upgrade for vulnerability ([#1952](https://github.com/wundergraph/cosmo/issues/1952)) ([71dbb5d](https://github.com/wundergraph/cosmo/commit/71dbb5d386789216bee39f6fcdd606bd383c19c2)) (@SkArchon)
* pnpm-lockfile to trigger ci and add back the specifier ([#1954](https://github.com/wundergraph/cosmo/issues/1954)) ([0149896](https://github.com/wundergraph/cosmo/commit/0149896ab2492757d0a88a6cbd1a26cee575d5cf)) (@SkArchon)

### Features

* improve apollo gateway compatible field selection validation ([#1941](https://github.com/wundergraph/cosmo/issues/1941)) ([64c0a6f](https://github.com/wundergraph/cosmo/commit/64c0a6f8da1360eaf031440da7816c53767ba060)) (@endigma)

## [0.219.3](https://github.com/wundergraph/cosmo/compare/router@0.219.2...router@0.219.3) (2025-06-10)

### Bug Fixes

* support different kinds of close, fix client complete not being reciprocated ([#1933](https://github.com/wundergraph/cosmo/issues/1933)) ([f511ce5](https://github.com/wundergraph/cosmo/commit/f511ce556a51220d285ec98990d6ed43450c0f9f)) (@endigma)

## [0.219.2](https://github.com/wundergraph/cosmo/compare/router@0.219.1...router@0.219.2) (2025-06-09)

### Bug Fixes

* variables in the event body should have a JSON renderer ([#1951](https://github.com/wundergraph/cosmo/issues/1951)) ([386e9a9](https://github.com/wundergraph/cosmo/commit/386e9a9a19e11f9a71b4780f70b83d4941f61bee)) (@alepane21)

## [0.219.1](https://github.com/wundergraph/cosmo/compare/router@0.219.0...router@0.219.1) (2025-06-06)

### Bug Fixes

* **router:** incorrect build constraint ([#1942](https://github.com/wundergraph/cosmo/issues/1942)) ([92370b9](https://github.com/wundergraph/cosmo/commit/92370b938a943f9ed0e3d6507823f1a5bb402750)) (@Noroth)

# [0.219.0](https://github.com/wundergraph/cosmo/compare/router@0.218.0...router@0.219.0) (2025-06-06)

### Features

* edfs refactor pubsub providers ([#1848](https://github.com/wundergraph/cosmo/issues/1848)) ([edb0ded](https://github.com/wundergraph/cosmo/commit/edb0dedd0e5d2a7e8748bbbd101e11cc109a65ef)) (@alepane21)

# [0.218.0](https://github.com/wundergraph/cosmo/compare/router@0.217.0...router@0.218.0) (2025-06-06)

### Bug Fixes

* golang/x/net vulnerability fixes (including engine upgrade which also has the net fix) ([#1932](https://github.com/wundergraph/cosmo/issues/1932)) ([69a7468](https://github.com/wundergraph/cosmo/commit/69a74688088f1feb2bc4a1b34500cd6b7cd18482)) (@SkArchon)
* resolve security vulnerabilities ([#1938](https://github.com/wundergraph/cosmo/issues/1938)) ([35e6c73](https://github.com/wundergraph/cosmo/commit/35e6c7374cd40f3e89655e08ec0671f2b30bc00c)) (@SkArchon)

### Features

* gRPC plugin enhancements ([#1905](https://github.com/wundergraph/cosmo/issues/1905)) ([7202ae9](https://github.com/wundergraph/cosmo/commit/7202ae9da4bd0d3ff85c4c632ff8fc44f8642471)) (@Noroth)

# [0.217.0](https://github.com/wundergraph/cosmo/compare/router@0.216.0...router@0.217.0) (2025-06-04)

### Features

* add custom field renderer via custom module ([#1930](https://github.com/wundergraph/cosmo/issues/1930)) ([2199a42](https://github.com/wundergraph/cosmo/commit/2199a42b654edcecc7f965fc41777043cd9790d6)) (@jensneuse)
* communicate downstream errors more effectively ([#1888](https://github.com/wundergraph/cosmo/issues/1888)) ([003187a](https://github.com/wundergraph/cosmo/commit/003187a95d20ee21fab4c15cb773cab7652b69ea)) (@endigma)

# [0.216.0](https://github.com/wundergraph/cosmo/compare/router@0.215.2...router@0.216.0) (2025-05-29)

### Features

* add new negate flag to regular expressions ([#1911](https://github.com/wundergraph/cosmo/issues/1911)) ([6744d9e](https://github.com/wundergraph/cosmo/commit/6744d9ecb3a7a391a7a88d4ec7d72bf85717ee63)) (@SkArchon)

## [0.215.2](https://github.com/wundergraph/cosmo/compare/router@0.215.1...router@0.215.2) (2025-05-27)

### Bug Fixes

* upgrade exprlang to 1.17.3 ([#1904](https://github.com/wundergraph/cosmo/issues/1904)) ([c1e895d](https://github.com/wundergraph/cosmo/commit/c1e895d6a37c398a27c2fd4204ae10fe9f966b43)) (@SkArchon)

## [0.215.1](https://github.com/wundergraph/cosmo/compare/router@0.215.0...router@0.215.1) (2025-05-26)

### Bug Fixes

*  detach fetches from objects, serial mutations execution, remove fetch id from operation name ([#1877](https://github.com/wundergraph/cosmo/issues/1877)) ([7dd7caa](https://github.com/wundergraph/cosmo/commit/7dd7caa78b65859ef4dd0b3a94d019c0a8c572ae)) (@devsergiy)

# [0.215.0](https://github.com/wundergraph/cosmo/compare/router@0.214.2...router@0.215.0) (2025-05-26)

### Bug Fixes

* **mcp:** rollback mcp library upgrade due to protocol support ([#1900](https://github.com/wundergraph/cosmo/issues/1900)) ([20c0959](https://github.com/wundergraph/cosmo/commit/20c09593f76b4586a919332a12adb83fbe6b9ab4)) (@StarpTech)

### Features

* add posthog to router ([#1882](https://github.com/wundergraph/cosmo/issues/1882)) ([27b4451](https://github.com/wundergraph/cosmo/commit/27b44514b2e13b815d0dd581fcd7edd65a0e8db0)) (@jensneuse)

## [0.214.2](https://github.com/wundergraph/cosmo/compare/router@0.214.1...router@0.214.2) (2025-05-26)

### Bug Fixes

* **mcp:** enable PING events by default to prevent proxy timeouts ([#1897](https://github.com/wundergraph/cosmo/issues/1897)) ([5b1a1b2](https://github.com/wundergraph/cosmo/commit/5b1a1b27a31bbf03c4b34f3dd2bcb5c6846a26d2)) (@StarpTech)

## [0.214.1](https://github.com/wundergraph/cosmo/compare/router@0.214.0...router@0.214.1) (2025-05-23)

### Bug Fixes

* use ms measurements instead of float seconds for conn_acquire_time ([#1889](https://github.com/wundergraph/cosmo/issues/1889)) ([fc8e440](https://github.com/wundergraph/cosmo/commit/fc8e440c26eb50218ef8dd97abedf6a2b9a15958)) (@SkArchon)

# [0.214.0](https://github.com/wundergraph/cosmo/compare/router@0.213.0...router@0.214.0) (2025-05-23)

### Features

* add subgraph expressions and tracing attributes ([#1870](https://github.com/wundergraph/cosmo/issues/1870)) ([368fa20](https://github.com/wundergraph/cosmo/commit/368fa2066e2414a7132d8079dc1570f7e06499e2)) (@SkArchon)

# [0.213.0](https://github.com/wundergraph/cosmo/compare/router@0.212.1...router@0.213.0) (2025-05-22)

### Features

* add new metric store with trace connection metrics ([#1862](https://github.com/wundergraph/cosmo/issues/1862)) ([772773d](https://github.com/wundergraph/cosmo/commit/772773d9b7b44485505cd90306f95f9504552a79)) (@SkArchon)
* add proper enabled config for plugins ([#1881](https://github.com/wundergraph/cosmo/issues/1881)) ([3114d38](https://github.com/wundergraph/cosmo/commit/3114d38ee39bd68a56c847e59fab253e18f7fabe)) (@Noroth)
* plugin init should bootstrap fully functional project ([#1878](https://github.com/wundergraph/cosmo/issues/1878)) ([69132da](https://github.com/wundergraph/cosmo/commit/69132da0f6a3560afcd6bdab348dec0bb37c3496)) (@StarpTech)

## [0.212.1](https://github.com/wundergraph/cosmo/compare/router@0.212.0...router@0.212.1) (2025-05-22)

**Note:** Version bump only for package router

# [0.212.0](https://github.com/wundergraph/cosmo/compare/router@0.211.0...router@0.212.0) (2025-05-19)

### Features

* **router:** grpc go plugin system ([#1866](https://github.com/wundergraph/cosmo/issues/1866)) ([280a61d](https://github.com/wundergraph/cosmo/commit/280a61de4bd1328549a023d1a3a0b702d78453b8)) (@Noroth)

# [0.211.0](https://github.com/wundergraph/cosmo/compare/router@0.210.2...router@0.211.0) (2025-05-19)

### Features

* **router:** hot config reloading ([#1746](https://github.com/wundergraph/cosmo/issues/1746)) ([e87d727](https://github.com/wundergraph/cosmo/commit/e87d727dd5c1bcd0f67b8f0f17294cc07ee372d8)) (@endigma)

## [0.210.2](https://github.com/wundergraph/cosmo/compare/router@0.210.1...router@0.210.2) (2025-05-16)

### Bug Fixes

* cleanup router config version from metrics ([#1846](https://github.com/wundergraph/cosmo/issues/1846)) ([eaccba8](https://github.com/wundergraph/cosmo/commit/eaccba8e9022001c0f3f7c9f3fbe228a4a435e72)) (@SkArchon)

## [0.210.1](https://github.com/wundergraph/cosmo/compare/router@0.210.0...router@0.210.1) (2025-05-15)

### Bug Fixes

* variables normalization ([#1865](https://github.com/wundergraph/cosmo/issues/1865)) ([7e05d4e](https://github.com/wundergraph/cosmo/commit/7e05d4e8cfe3657135b68eeecba1f87e8866edd3)) (@devsergiy)

# [0.210.0](https://github.com/wundergraph/cosmo/compare/router@0.209.0...router@0.210.0) (2025-05-13)

### Features

* add demo configuration ([#1796](https://github.com/wundergraph/cosmo/issues/1796)) ([af1d37b](https://github.com/wundergraph/cosmo/commit/af1d37bb833a9dadf3de9d6cd210f048e3c0687c)) (@alepane21)

# [0.209.0](https://github.com/wundergraph/cosmo/compare/router@0.208.0...router@0.209.0) (2025-05-13)

### Features

* add support for mcp base server url, upgrade mcp-go ([#1845](https://github.com/wundergraph/cosmo/issues/1845)) ([7045d4c](https://github.com/wundergraph/cosmo/commit/7045d4cabb9fd01b924360b426316c034b088625)) (@StarpTech)

# [0.208.0](https://github.com/wundergraph/cosmo/compare/router@0.207.0...router@0.208.0) (2025-05-09)

### Features

* **playground:** add support for state sharing via URL with user control over what to include ([#1833](https://github.com/wundergraph/cosmo/issues/1833)) ([c630c9f](https://github.com/wundergraph/cosmo/commit/c630c9f6833de3d071e12f825ed75f2630a9b7e9)) (@akshaygarg576)

# [0.207.0](https://github.com/wundergraph/cosmo/compare/router@0.206.1...router@0.207.0) (2025-05-09)

### Features

* expose router version as a gauge value ([#1803](https://github.com/wundergraph/cosmo/issues/1803)) ([ec7c826](https://github.com/wundergraph/cosmo/commit/ec7c826870e63f8986061580ea6a6ca73a0a33f5)) (@SkArchon)

## [0.206.1](https://github.com/wundergraph/cosmo/compare/router@0.206.0...router@0.206.1) (2025-05-08)

### Bug Fixes

* call safelisted operation after persisted one; feat: add file storage for persisted operations ([#1837](https://github.com/wundergraph/cosmo/issues/1837)) ([679445e](https://github.com/wundergraph/cosmo/commit/679445e4934b7cb86c535b98901b9e0db1df47b9)) (@devsergiy)

# [0.206.0](https://github.com/wundergraph/cosmo/compare/router@0.205.1...router@0.206.0) (2025-05-06)

### Features

* add support for deprecated arguments in introspection ([#1835](https://github.com/wundergraph/cosmo/issues/1835)) ([eb167dd](https://github.com/wundergraph/cosmo/commit/eb167dd2af412f997cf5d3decd1738852c31b825)) (@devsergiy)

## [0.205.1](https://github.com/wundergraph/cosmo/compare/router@0.205.0...router@0.205.1) (2025-05-06)

### Bug Fixes

* update go tools ([#1834](https://github.com/wundergraph/cosmo/issues/1834)) ([5f5664e](https://github.com/wundergraph/cosmo/commit/5f5664e877282f5c60d21b61a937c9cbee1095da)) (@jensneuse)

# [0.205.0](https://github.com/wundergraph/cosmo/compare/router@0.204.2...router@0.205.0) (2025-05-02)

### Features

* expose mcp listen addr for full flexibility ([#1825](https://github.com/wundergraph/cosmo/issues/1825)) ([4a7447a](https://github.com/wundergraph/cosmo/commit/4a7447a64646aa484bc2039ae323bafd967bddb5)) (@StarpTech)

## [0.204.2](https://github.com/wundergraph/cosmo/compare/router@0.204.1...router@0.204.2) (2025-04-30)

### Bug Fixes

* evaluate keys using order of target subgraph ([#1822](https://github.com/wundergraph/cosmo/issues/1822)) ([a5b9815](https://github.com/wundergraph/cosmo/commit/a5b9815b2a79cea50fd4540d3ba56c1c94480677)) (@devsergiy)
* improve error handling in metric flushing methods ([#1819](https://github.com/wundergraph/cosmo/issues/1819)) ([97402d6](https://github.com/wundergraph/cosmo/commit/97402d671ffa9565fca0df2a99095b28d8c8e339)) (@alepane21)

## [0.204.1](https://github.com/wundergraph/cosmo/compare/router@0.204.0...router@0.204.1) (2025-04-29)

### Bug Fixes

* set cache-control to `no-store` when errors are present, engine v2.0.0-rc.175 ([#1795](https://github.com/wundergraph/cosmo/issues/1795)) ([0cd3162](https://github.com/wundergraph/cosmo/commit/0cd31622667f94074fcacca2b6b8153915fd6767)) (@endigma)

# [0.204.0](https://github.com/wundergraph/cosmo/compare/router@0.203.0...router@0.204.0) (2025-04-29)

### Features

* **subscriptions:** user proper frame timeout ([#1820](https://github.com/wundergraph/cosmo/issues/1820)) ([3b540fc](https://github.com/wundergraph/cosmo/commit/3b540fced5cebabcc31cdaf9bddf07b3b5a4932a)) (@StarpTech)

# [0.203.0](https://github.com/wundergraph/cosmo/compare/router@0.202.1...router@0.203.0) (2025-04-25)

### Features

* pass read timeout to subscription client ([#1814](https://github.com/wundergraph/cosmo/issues/1814)) ([ef2ee40](https://github.com/wundergraph/cosmo/commit/ef2ee4019e9cb63a4c24af66ccc3290534008cb7)) (@StarpTech)

## [0.202.1](https://github.com/wundergraph/cosmo/compare/router@0.202.0...router@0.202.1) (2025-04-22)

**Note:** Version bump only for package router

# [0.202.0](https://github.com/wundergraph/cosmo/compare/router@0.201.1...router@0.202.0) (2025-04-22)

### Features

* rework key matching logic, add engine support for fragments in provides/requires ([#1759](https://github.com/wundergraph/cosmo/issues/1759)) ([032d847](https://github.com/wundergraph/cosmo/commit/032d847d968f67f07d926cb8d6b0d546e953d23b)) (@devsergiy)

## [0.201.1](https://github.com/wundergraph/cosmo/compare/router@0.201.0...router@0.201.1) (2025-04-22)

### Bug Fixes

* s3 remove unnecessary required fields in json schema ([#1807](https://github.com/wundergraph/cosmo/issues/1807)) ([3b29955](https://github.com/wundergraph/cosmo/commit/3b29955530c23058511688ffa457840771c71fc0)) (@StarpTech)

# [0.201.0](https://github.com/wundergraph/cosmo/compare/router@0.200.1...router@0.201.0) (2025-04-22)

### Features

* **router:** schema usage lite export via prometheus ([#1704](https://github.com/wundergraph/cosmo/issues/1704)) ([f5a4707](https://github.com/wundergraph/cosmo/commit/f5a470720ceb07ce5656a9b8ca2177e7b705bdfc)) (@endigma)

## [0.200.1](https://github.com/wundergraph/cosmo/compare/router@0.200.0...router@0.200.1) (2025-04-22)

### Bug Fixes

* **subscriptions:** dont use completed channel in sub updater ([#1802](https://github.com/wundergraph/cosmo/issues/1802)) ([973d2cc](https://github.com/wundergraph/cosmo/commit/973d2ccd37d721f3ccbca2c897f34d59bc00cf80)) (@StarpTech)

# [0.200.0](https://github.com/wundergraph/cosmo/compare/router@0.199.1...router@0.200.0) (2025-04-18)

### Bug Fixes

* **router:** refactor per-subgraph transport options to avoid leaking goroutines ([#1773](https://github.com/wundergraph/cosmo/issues/1773)) ([b233751](https://github.com/wundergraph/cosmo/commit/b2337519b0837e0bfc9d9ec04d051ebeb4894412)) (@endigma)

### Features

* mcp server support in the router ([#1786](https://github.com/wundergraph/cosmo/issues/1786)) ([3bd8a5e](https://github.com/wundergraph/cosmo/commit/3bd8a5ead43fd8c8a2c62d18fae163d7c0cff8db)) (@StarpTech)

## [0.199.1](https://github.com/wundergraph/cosmo/compare/router@0.199.0...router@0.199.1) (2025-04-16)

### Bug Fixes

* add subscription spec header to content type for certain clients that require it ([#1728](https://github.com/wundergraph/cosmo/issues/1728)) ([5f65587](https://github.com/wundergraph/cosmo/commit/5f6558788eb0db576c92362d52519c0d506acd99)) (@SkArchon)

# [0.199.0](https://github.com/wundergraph/cosmo/compare/router@0.198.0...router@0.199.0) (2025-04-15)

### Features

* implement proposals in cosmo ([#1727](https://github.com/wundergraph/cosmo/issues/1727)) ([1d36747](https://github.com/wundergraph/cosmo/commit/1d36747dda3f2f3c491092f0f02cefa22fc9c131)) (@JivusAyrus)

# [0.198.0](https://github.com/wundergraph/cosmo/compare/router@0.197.1...router@0.198.0) (2025-04-15)

### Features

* query batching ([#1749](https://github.com/wundergraph/cosmo/issues/1749)) ([b2a1d52](https://github.com/wundergraph/cosmo/commit/b2a1d523b6de9e7a6854e93464c47d6bbe1de06f)) (@SkArchon)

## [0.197.1](https://github.com/wundergraph/cosmo/compare/router@0.197.0...router@0.197.1) (2025-04-11)

### Bug Fixes

* **router:** graceful shutdown blocked by in-flight requests due to lock ([#1771](https://github.com/wundergraph/cosmo/issues/1771)) ([c98453b](https://github.com/wundergraph/cosmo/commit/c98453bda9dc411dd611f4c141dae314ec5ea5f9)) (@Noroth)

# [0.197.0](https://github.com/wundergraph/cosmo/compare/router@0.196.1...router@0.197.0) (2025-04-10)

### Bug Fixes

* ensure utf-8 charset is set on JSON responses ([#1760](https://github.com/wundergraph/cosmo/issues/1760)) ([8d7afe6](https://github.com/wundergraph/cosmo/commit/8d7afe63fc83b6bf1412d52647d1fee8bc39a355)) (@StarpTech)

### Features

* header forwarding should allow expressions ([#1745](https://github.com/wundergraph/cosmo/issues/1745)) ([75a2a4c](https://github.com/wundergraph/cosmo/commit/75a2a4c5614ace0687c5a0bcf16940581d86ad7f)) (@alepane21)

## [0.196.1](https://github.com/wundergraph/cosmo/compare/router@0.196.0...router@0.196.1) (2025-04-07)

### Bug Fixes

* **websocket:** handle ping/pong correctly ([#1755](https://github.com/wundergraph/cosmo/issues/1755)) ([ead4f4e](https://github.com/wundergraph/cosmo/commit/ead4f4e816a2bca017c1e44a547c8cbccf751dc0)) (@StarpTech)

# [0.196.0](https://github.com/wundergraph/cosmo/compare/router@0.195.0...router@0.196.0) (2025-04-07)

### Features

* add execution of check_query_planner ([#1661](https://github.com/wundergraph/cosmo/issues/1661)) ([90a17f9](https://github.com/wundergraph/cosmo/commit/90a17f995cb52e38584cef830cc6b214d21e44af)) (@alepane21)

# [0.195.0](https://github.com/wundergraph/cosmo/compare/router@0.194.0...router@0.195.0) (2025-04-04)

### Bug Fixes

* **router:** update JWK dependency ([#1751](https://github.com/wundergraph/cosmo/issues/1751)) ([c4c5611](https://github.com/wundergraph/cosmo/commit/c4c5611f8886f867722fb76def78163e1a290b0b)) (@MicahParks)

### Features

* add option to disable exposing variables content on validation error ([#1753](https://github.com/wundergraph/cosmo/issues/1753)) ([d78076f](https://github.com/wundergraph/cosmo/commit/d78076f86068799fb9ffab4ca92587e31077cbe3)) (@jensneuse)

# [0.194.0](https://github.com/wundergraph/cosmo/compare/router@0.193.3...router@0.194.0) (2025-04-02)

### Features

* add support to set ClientInfo from initial payload when using WebSockets ([#1744](https://github.com/wundergraph/cosmo/issues/1744)) ([7dd44cb](https://github.com/wundergraph/cosmo/commit/7dd44cbfb581410266c0a9c24299aceb8b0dc186)) (@jensneuse)

## [0.193.3](https://github.com/wundergraph/cosmo/compare/router@0.193.2...router@0.193.3) (2025-04-01)

### Bug Fixes

* **websocket:** improve write and read deadlines ([#1693](https://github.com/wundergraph/cosmo/issues/1693)) ([99a3a88](https://github.com/wundergraph/cosmo/commit/99a3a88da188d1c59a208254c4707c4881b7a479)) (@StarpTech)

## [0.193.2](https://github.com/wundergraph/cosmo/compare/router@0.193.1...router@0.193.2) (2025-04-01)

### Bug Fixes

* subgraph error code is not propagated AND panics on websocket request logging ([#1738](https://github.com/wundergraph/cosmo/issues/1738)) ([beff6d7](https://github.com/wundergraph/cosmo/commit/beff6d7bab74e4e8fb18d49d30b9ec4bc692ace1)) (@SkArchon)

## [0.193.1](https://github.com/wundergraph/cosmo/compare/router@0.193.0...router@0.193.1) (2025-03-28)

### Bug Fixes

* authorization directive cascading ([#1733](https://github.com/wundergraph/cosmo/issues/1733)) ([0199fb5](https://github.com/wundergraph/cosmo/commit/0199fb5f88104a585b74a79638f54f1a3b812436)) (@Aenimus)

# [0.193.0](https://github.com/wundergraph/cosmo/compare/router@0.192.3...router@0.193.0) (2025-03-26)

### Features

* add request body to expression context ([#1664](https://github.com/wundergraph/cosmo/issues/1664)) ([8929aa4](https://github.com/wundergraph/cosmo/commit/8929aa4049f9bc00a132023e6ad6828a9bb269c9)) (@SkArchon)
* add the ability to check if the request has been sampled using the expression context ([#1721](https://github.com/wundergraph/cosmo/issues/1721)) ([9fefa9a](https://github.com/wundergraph/cosmo/commit/9fefa9a773fe015e55442ccf1c3a8bbaa16dabdd)) (@SkArchon)

## [0.192.3](https://github.com/wundergraph/cosmo/compare/router@0.192.2...router@0.192.3) (2025-03-25)

### Bug Fixes

* catch an error on provides with fragments ([#1723](https://github.com/wundergraph/cosmo/issues/1723)) ([9bb5de6](https://github.com/wundergraph/cosmo/commit/9bb5de67bcc1df486181c9c6ff6166bde64aab78)) (@devsergiy)

## [0.192.2](https://github.com/wundergraph/cosmo/compare/router@0.192.1...router@0.192.2) (2025-03-25)

### Bug Fixes

* ensure to close any responses before retrying ([#1713](https://github.com/wundergraph/cosmo/issues/1713)) ([0f21399](https://github.com/wundergraph/cosmo/commit/0f21399c19ebea3b4a65caeb7ccee9622a7a2cd5)) (@SkArchon)
* updated go jwt dependency to fix vulnerability ([#1714](https://github.com/wundergraph/cosmo/issues/1714)) ([247b3cf](https://github.com/wundergraph/cosmo/commit/247b3cf5ee65a12910b68aca363e5ad3ec2a8be5)) (@SkArchon)
* upgrade `vite` to solve vulnerability ([#1700](https://github.com/wundergraph/cosmo/issues/1700)) ([a8bb8e5](https://github.com/wundergraph/cosmo/commit/a8bb8e591d1a0523ad77a593240aef7974e7c8b3)) (@wilsonrivera)

## [0.192.1](https://github.com/wundergraph/cosmo/compare/router@0.192.0...router@0.192.1) (2025-03-19)

### Bug Fixes

* prefer json as a content type for non subscriptions ([#1705](https://github.com/wundergraph/cosmo/issues/1705)) ([40ebbb1](https://github.com/wundergraph/cosmo/commit/40ebbb1b3450bca6a2183bd68b3f92e9d3b8d9d1)) (@SkArchon)
* upgrade expr package ([#1703](https://github.com/wundergraph/cosmo/issues/1703)) ([6799c2b](https://github.com/wundergraph/cosmo/commit/6799c2b615e08e70e969707422f3e6e0b1fc78f7)) (@Noroth)

# [0.192.0](https://github.com/wundergraph/cosmo/compare/router@0.191.0...router@0.192.0) (2025-03-14)

### Bug Fixes

* polling based execution config watcher ([#1671](https://github.com/wundergraph/cosmo/issues/1671)) ([31564fd](https://github.com/wundergraph/cosmo/commit/31564fd9841cdbd375d32b66e2aee105ace7305c)) (@endigma)

### Features

* **plan-generator:** add max concurrent data source collectors; update engine to v2.0.0-rc.165 ([#1690](https://github.com/wundergraph/cosmo/issues/1690)) ([f6b40ed](https://github.com/wundergraph/cosmo/commit/f6b40eda3602f84b62feb1f830c1aac4b3af2602)) (@alepane21)

# [0.191.0](https://github.com/wundergraph/cosmo/compare/router@0.190.0...router@0.191.0) (2025-03-13)

### Features

* **router:** add support for jwks discovery via openid-configuration endpoint ([#1646](https://github.com/wundergraph/cosmo/issues/1646)) ([b780408](https://github.com/wundergraph/cosmo/commit/b7804088a122eee3a250da174d9e26022c06726f)) (@Noroth)
* update engine to rc.164 ([#1687](https://github.com/wundergraph/cosmo/issues/1687)) ([7cd0340](https://github.com/wundergraph/cosmo/commit/7cd034043ad522105f181faa9ef088a343749dc4)) (@Aenimus)

# [0.190.0](https://github.com/wundergraph/cosmo/compare/router@0.189.2...router@0.190.0) (2025-03-12)

### Features

* **plan-generator:** improve memory and cpu usage ([#1684](https://github.com/wundergraph/cosmo/issues/1684)) ([74d72d8](https://github.com/wundergraph/cosmo/commit/74d72d8675656474190f8b1556c727406a866464)) (@alepane21)

## [0.189.2](https://github.com/wundergraph/cosmo/compare/router@0.189.1...router@0.189.2) (2025-03-12)

### Bug Fixes

* make multipart subscriptions compatible with client ([#1675](https://github.com/wundergraph/cosmo/issues/1675)) ([7a0c3ef](https://github.com/wundergraph/cosmo/commit/7a0c3ef2d23446a0e629466af752c4811296e836)) (@SkArchon)

## [0.189.1](https://github.com/wundergraph/cosmo/compare/router@0.189.0...router@0.189.1) (2025-03-10)

### Bug Fixes

* resolve multipart not working properly for some clients ([#1650](https://github.com/wundergraph/cosmo/issues/1650)) ([8b2d35a](https://github.com/wundergraph/cosmo/commit/8b2d35a72022957e13bf158092ba32d58b757623)) (@SkArchon)

# [0.189.0](https://github.com/wundergraph/cosmo/compare/router@0.188.2...router@0.189.0) (2025-03-07)

### Features

* **plan-generator:** enhance error reporting in query plan results ([#1663](https://github.com/wundergraph/cosmo/issues/1663)) ([7b58813](https://github.com/wundergraph/cosmo/commit/7b58813b085e958fb8c1e093c55127f8244269e8)) (@alepane21)

## [0.188.2](https://github.com/wundergraph/cosmo/compare/router@0.188.1...router@0.188.2) (2025-03-04)

### Bug Fixes

* value completion propagation for invalid enum values ([#1654](https://github.com/wundergraph/cosmo/issues/1654)) ([da7615d](https://github.com/wundergraph/cosmo/commit/da7615d42e0f8d9617b81b124508c0c826bc7651)) (@Aenimus)

## [0.188.1](https://github.com/wundergraph/cosmo/compare/router@0.188.0...router@0.188.1) (2025-03-04)

### Bug Fixes

* reading file uploads map by ignoring actual indices in map ([#1653](https://github.com/wundergraph/cosmo/issues/1653)) ([a262784](https://github.com/wundergraph/cosmo/commit/a26278475dfb1b426c6e4e66cb3f34ad09a9c90d)) (@devsergiy)

# [0.188.0](https://github.com/wundergraph/cosmo/compare/router@0.187.1...router@0.188.0) (2025-03-04)

### Bug Fixes

* **subscription:** never try to send on blocked channel when subscription was completed ([#1641](https://github.com/wundergraph/cosmo/issues/1641)) ([87cff19](https://github.com/wundergraph/cosmo/commit/87cff194832aa9b9326e2abfba01d69a0dd72d6d)) (@StarpTech)

### Features

* **router:** add RouterOnRequest hook ([#1642](https://github.com/wundergraph/cosmo/issues/1642)) ([22ecac7](https://github.com/wundergraph/cosmo/commit/22ecac7f6cf39cad586b62f03a542aef500c7cf7)) (@SkArchon)

## [0.187.1](https://github.com/wundergraph/cosmo/compare/router@0.187.0...router@0.187.1) (2025-03-03)

### Bug Fixes

* list of uploads remapping when variables remap enabled ([#1647](https://github.com/wundergraph/cosmo/issues/1647)) ([acec7d0](https://github.com/wundergraph/cosmo/commit/acec7d080faeae04d5af9f74fa2ec79d9124341b)) (@devsergiy)

# [0.187.0](https://github.com/wundergraph/cosmo/compare/router@0.186.0...router@0.187.0) (2025-03-03)

### Bug Fixes

* **subscriptions:** skip event after worker shutdown ([#1630](https://github.com/wundergraph/cosmo/issues/1630)) ([eb2ba77](https://github.com/wundergraph/cosmo/commit/eb2ba7733ae5430fc64335033043a9b4cac37c27)) (@StarpTech)

### Features

* option to remove scopeinfo from prometheus metrics ([#1639](https://github.com/wundergraph/cosmo/issues/1639)) ([c6be7b4](https://github.com/wundergraph/cosmo/commit/c6be7b4eefee0e7f0e721bc5ef809a1d6877ff11)) (@endigma)

# [0.186.0](https://github.com/wundergraph/cosmo/compare/router@0.185.0...router@0.186.0) (2025-02-27)

### Features

* improve the cache warmer operations manifest for persisted operations ([#1599](https://github.com/wundergraph/cosmo/issues/1599)) ([2579a1c](https://github.com/wundergraph/cosmo/commit/2579a1c7d9c4618efba37e340d27dff9edd6136d)) (@JivusAyrus)
* **router:** template expressions for access logs ([#1612](https://github.com/wundergraph/cosmo/issues/1612)) ([97bebe3](https://github.com/wundergraph/cosmo/commit/97bebe35bdb24cd6bf3d7bd08e3de954a8e37fba)) (@SkArchon)

# [0.185.0](https://github.com/wundergraph/cosmo/compare/router@0.184.0...router@0.185.0) (2025-02-27)

### Features

* add query plan generator to router ([#1627](https://github.com/wundergraph/cosmo/issues/1627)) ([846d069](https://github.com/wundergraph/cosmo/commit/846d0696b945c3b464e5f3d99a2e4c7a4e64c393)) (@alepane21)

# [0.184.0](https://github.com/wundergraph/cosmo/compare/router@0.183.2...router@0.184.0) (2025-02-26)

### Features

* support nested file uploads, support any name for the file upload ([#1631](https://github.com/wundergraph/cosmo/issues/1631)) ([669afce](https://github.com/wundergraph/cosmo/commit/669afce4a8504dccb27c1fa9be4631a3d300a735)) (@devsergiy)

## [0.183.2](https://github.com/wundergraph/cosmo/compare/router@0.183.1...router@0.183.2) (2025-02-24)

### Bug Fixes

* fix node selections do not select external parents of unique node ([#1622](https://github.com/wundergraph/cosmo/issues/1622)) ([902bda8](https://github.com/wundergraph/cosmo/commit/902bda8bda6473b896c6f0945dd6ea17490a2cf2)) (@devsergiy)

## [0.183.1](https://github.com/wundergraph/cosmo/compare/router@0.183.0...router@0.183.1) (2025-02-21)

### Bug Fixes

* set responseWriter in requestContext to the wrapped one ([#1609](https://github.com/wundergraph/cosmo/issues/1609)) ([e96525e](https://github.com/wundergraph/cosmo/commit/e96525e6fea14a5250fb2c56d05ec6be805dec62)) (@endigma)

# [0.183.0](https://github.com/wundergraph/cosmo/compare/router@0.182.0...router@0.183.0) (2025-02-21)

### Features

* add expressions to metrics ([#1556](https://github.com/wundergraph/cosmo/issues/1556)) ([a7f643a](https://github.com/wundergraph/cosmo/commit/a7f643aaa65c0a6d7882b17bd9bb3f3249f6b88e)) (@alepane21)

# [0.182.0](https://github.com/wundergraph/cosmo/compare/router@0.181.1...router@0.182.0) (2025-02-20)

### Bug Fixes

* **router:** handle repeated headers in response ([#1537](https://github.com/wundergraph/cosmo/issues/1537)) ([39aa96b](https://github.com/wundergraph/cosmo/commit/39aa96b107000b2a57c8c88f5b1b7aade0110bdd)) (@cmtm)

### Features

* **subscription:** mutex free subscription implementation ([#1613](https://github.com/wundergraph/cosmo/issues/1613)) ([c17f8f6](https://github.com/wundergraph/cosmo/commit/c17f8f635e00bab24e7184a9ac0a2ec5df180c92)) (@StarpTech)

## [0.181.1](https://github.com/wundergraph/cosmo/compare/router@0.181.0...router@0.181.1) (2025-02-19)

### Bug Fixes

* add a hardcoded cookie whitelist for internal cookie names ([#1605](https://github.com/wundergraph/cosmo/issues/1605)) ([3ddb078](https://github.com/wundergraph/cosmo/commit/3ddb07832225a273775589d83bfa1d8a91b7e174)) (@endigma)

# [0.181.0](https://github.com/wundergraph/cosmo/compare/router@0.180.1...router@0.181.0) (2025-02-19)

### Features

* **router:** cookie header whitelist ([#1604](https://github.com/wundergraph/cosmo/issues/1604)) ([7784207](https://github.com/wundergraph/cosmo/commit/778420703ea46ddb2bd82d262cdbc8d52e6badcd)) (@endigma)

## [0.180.1](https://github.com/wundergraph/cosmo/compare/router@0.180.0...router@0.180.1) (2025-02-18)

### Bug Fixes

* **router:** send graphql closing boundary to fit Apollo client ([#1579](https://github.com/wundergraph/cosmo/issues/1579)) ([c3d089a](https://github.com/wundergraph/cosmo/commit/c3d089a284f76469a2486032fb42f3c4f650c986)) (@df-wg)

# [0.180.0](https://github.com/wundergraph/cosmo/compare/router@0.179.0...router@0.180.0) (2025-02-18)

### Features

* set the scopes on request without authentication ([#1598](https://github.com/wundergraph/cosmo/issues/1598)) ([43b4ea5](https://github.com/wundergraph/cosmo/commit/43b4ea556e3915ddba3b771428426e00c09991f6)) (@alepane21)

# [0.179.0](https://github.com/wundergraph/cosmo/compare/router@0.178.0...router@0.179.0) (2025-02-18)

### Features

* **engine:** apollo router compatible non-2XX response errors ([#1602](https://github.com/wundergraph/cosmo/issues/1602)) ([efa3ff4](https://github.com/wundergraph/cosmo/commit/efa3ff45b8076eba63f588155b979d9b9fdc3ef8)) (@endigma)

# [0.178.0](https://github.com/wundergraph/cosmo/compare/router@0.177.2...router@0.178.0) (2025-02-17)

### Features

* add composition versioning ([#1575](https://github.com/wundergraph/cosmo/issues/1575)) ([ee32cbb](https://github.com/wundergraph/cosmo/commit/ee32cbb3dbe7c46fa984920bbd95e4a00d01c9c3)) (@Aenimus)

## [0.177.2](https://github.com/wundergraph/cosmo/compare/router@0.177.1...router@0.177.2) (2025-02-15)

### Bug Fixes

* **engine:** deadlock when waiting on inflight events of a trigger ([#1597](https://github.com/wundergraph/cosmo/issues/1597)) ([297273d](https://github.com/wundergraph/cosmo/commit/297273d749ebbafe61732a261bd19477bab3115a)) (@StarpTech)

## [0.177.1](https://github.com/wundergraph/cosmo/compare/router@0.177.0...router@0.177.1) (2025-02-14)

### Bug Fixes

* apollo router compatibility yaml property ([#1596](https://github.com/wundergraph/cosmo/issues/1596)) ([e068a7e](https://github.com/wundergraph/cosmo/commit/e068a7efd01650bfa9d302f6d171b0d33c295368)) (@Aenimus)

# [0.177.0](https://github.com/wundergraph/cosmo/compare/router@0.176.0...router@0.177.0) (2025-02-14)

### Features

* apollo router compatibility options + router-like invalid vars ([#1594](https://github.com/wundergraph/cosmo/issues/1594)) ([4e73ca7](https://github.com/wundergraph/cosmo/commit/4e73ca7eb1475e387f58f10de462bf434de8d9e2)) (@endigma)

# [0.176.0](https://github.com/wundergraph/cosmo/compare/router@0.175.1...router@0.176.0) (2025-02-13)

### Bug Fixes

* fix printing object value with optional fields in variables normalization ([#1592](https://github.com/wundergraph/cosmo/issues/1592)) ([267303c](https://github.com/wundergraph/cosmo/commit/267303c438171d8d493af553f52e6556f932c503)) (@devsergiy)

### Features

* **router:** enable safelist for persisted operations ([#1561](https://github.com/wundergraph/cosmo/issues/1561)) ([b81b828](https://github.com/wundergraph/cosmo/commit/b81b8287c6f223ea6c7e9be4111f132c55128043)) (@df-wg)
* **router:** make header matching rules case insensitive ([#1584](https://github.com/wundergraph/cosmo/issues/1584)) ([c0bceaa](https://github.com/wundergraph/cosmo/commit/c0bceaa7410a27e9be981e8acb320db58d07b4b9)) (@df-wg)

## [0.175.1](https://github.com/wundergraph/cosmo/compare/router@0.175.0...router@0.175.1) (2025-02-12)

### Bug Fixes

* interface objects typename checks ([#1585](https://github.com/wundergraph/cosmo/issues/1585)) ([07b6464](https://github.com/wundergraph/cosmo/commit/07b6464ef2a6af66390895e38dd7b7ecd2204ed2)) (@devsergiy)

# [0.175.0](https://github.com/wundergraph/cosmo/compare/router@0.174.3...router@0.175.0) (2025-02-12)

### Features

* add apollo compatibility flag replace invalid var error status ([#1587](https://github.com/wundergraph/cosmo/issues/1587)) ([d95e910](https://github.com/wundergraph/cosmo/commit/d95e910003ebe3222fab09629fccbf6d55b67abc)) (@Aenimus)

## [0.174.3](https://github.com/wundergraph/cosmo/compare/router@0.174.2...router@0.174.3) (2025-02-12)

### Bug Fixes

* makes default config options work properly within maps ([#1577](https://github.com/wundergraph/cosmo/issues/1577)) ([899de99](https://github.com/wundergraph/cosmo/commit/899de9913cb139125b9d5ff75e3db71b7df93011)) (@endigma)

## [0.174.2](https://github.com/wundergraph/cosmo/compare/router@0.174.1...router@0.174.2) (2025-02-11)

### Bug Fixes

* websocket url in router playground ([#1583](https://github.com/wundergraph/cosmo/issues/1583)) ([8523ace](https://github.com/wundergraph/cosmo/commit/8523aceca6ecbed7e0318c5cf1115f9c00a3f933)) (@thisisnithin)

## [0.174.1](https://github.com/wundergraph/cosmo/compare/router@0.174.0...router@0.174.1) (2025-02-07)

### Bug Fixes

* extracting arguments input objects with optional variables ([#1574](https://github.com/wundergraph/cosmo/issues/1574)) ([f63ac1a](https://github.com/wundergraph/cosmo/commit/f63ac1a09e748ccf6996ea7abd948e0ba5a3b941)) (@devsergiy)

# [0.174.0](https://github.com/wundergraph/cosmo/compare/router@0.173.0...router@0.174.0) (2025-02-07)

### Bug Fixes

* querying fields under external path used in a composite key with nested fields ([#1573](https://github.com/wundergraph/cosmo/issues/1573)) ([e053fad](https://github.com/wundergraph/cosmo/commit/e053fad861f639caf5eaff94cd52c0338c50d1cc)) (@devsergiy)

### Features

* add plan cmd and plan generator ([#1539](https://github.com/wundergraph/cosmo/issues/1539)) ([586ca21](https://github.com/wundergraph/cosmo/commit/586ca21a0da1eb7f3e889281cf4bc4ea0c15a2b6)) (@devsergiy)

# [0.173.0](https://github.com/wundergraph/cosmo/compare/router@0.172.0...router@0.173.0) (2025-02-06)

### Features

* **router:** add configurable connection limits for each subgraph ([#1558](https://github.com/wundergraph/cosmo/issues/1558)) ([e9a8a3b](https://github.com/wundergraph/cosmo/commit/e9a8a3b874395c59585b784dd74067669ef46278)) (@endigma)

# [0.172.0](https://github.com/wundergraph/cosmo/compare/router@0.171.1...router@0.172.0) (2025-02-06)

### Features

* add a flag to disable variables remapping ([#1570](https://github.com/wundergraph/cosmo/issues/1570)) ([9cf3374](https://github.com/wundergraph/cosmo/commit/9cf337429682522d490a99ed63b9036bec169b5e)) (@devsergiy)

## [0.171.1](https://github.com/wundergraph/cosmo/compare/router@0.171.0...router@0.171.1) (2025-02-05)

### Bug Fixes

* inject a per-subgraph http.Client to fix timeout race issue ([#1567](https://github.com/wundergraph/cosmo/issues/1567)) ([6501202](https://github.com/wundergraph/cosmo/commit/6501202688c8dca2519adf1a75ac12efedd162cb)) (@endigma)

# [0.171.0](https://github.com/wundergraph/cosmo/compare/router@0.170.1...router@0.171.0) (2025-02-05)

### Bug Fixes

* **router:** enable redis to work with auth ([#1563](https://github.com/wundergraph/cosmo/issues/1563)) ([d9fd035](https://github.com/wundergraph/cosmo/commit/d9fd03544738c0b716364eb3c0b9c9337e50a3fc)) (@df-wg)

### Features

* **router:** support gzip request compression ([#1559](https://github.com/wundergraph/cosmo/issues/1559)) ([5f1d2a7](https://github.com/wundergraph/cosmo/commit/5f1d2a75ea2d99879429456b794dd4e424d70710)) (@Noroth)

## [0.170.1](https://github.com/wundergraph/cosmo/compare/router@0.170.0...router@0.170.1) (2025-02-03)

### Bug Fixes

* incorrect graphql endpoint in playground ([#1562](https://github.com/wundergraph/cosmo/issues/1562)) ([2e680ce](https://github.com/wundergraph/cosmo/commit/2e680ce7e6e0a584b13d3ee3aa314ab6e9a051c2)) (@thisisnithin)

# [0.170.0](https://github.com/wundergraph/cosmo/compare/router@0.169.0...router@0.170.0) (2025-01-31)

### Bug Fixes

* error when graph token is not set when cache warmup is enabled ([#1554](https://github.com/wundergraph/cosmo/issues/1554)) ([fea311f](https://github.com/wundergraph/cosmo/commit/fea311f392879a2e0abd135dffcd68bffacb0c8c)) (@StarpTech)
* json schema for traffic shaping subgraphs ([#1552](https://github.com/wundergraph/cosmo/issues/1552)) ([b99e0bc](https://github.com/wundergraph/cosmo/commit/b99e0bca9dc2492f6d40982fefde9b1fce55b842)) (@StarpTech)
* subgraph timeout can't be bigger than global timeout ([#1548](https://github.com/wundergraph/cosmo/issues/1548)) ([92b69a3](https://github.com/wundergraph/cosmo/commit/92b69a39db17cd5aa6ad69537a8c50e41c9a89ed)) (@devsergiy)

### Features

* **router:** enable using redis clusters for rate limiting and apq ([#1499](https://github.com/wundergraph/cosmo/issues/1499)) ([7c5b3a7](https://github.com/wundergraph/cosmo/commit/7c5b3a772f1f524a1afda14ca2f62cf5a2c5a46a)) (@df-wg)

# [0.169.0](https://github.com/wundergraph/cosmo/compare/router@0.168.1...router@0.169.0) (2025-01-31)

### Bug Fixes

* increase the test timeout value to prevent failures on slower machines ([#1547](https://github.com/wundergraph/cosmo/issues/1547)) ([b850fd7](https://github.com/wundergraph/cosmo/commit/b850fd71d1f8e8c7a2c4b5f6006ea66794901562)) (@alepane21)
* **router:** parse accept header per rfc 9110 ([#1549](https://github.com/wundergraph/cosmo/issues/1549)) ([cbd8edc](https://github.com/wundergraph/cosmo/commit/cbd8edc74817a242381b74aad7eeb1ed9a4c29ea)) (@df-wg)

### Features

* **router:** enable starting the router without subgraphs ([#1533](https://github.com/wundergraph/cosmo/issues/1533)) ([806d3b4](https://github.com/wundergraph/cosmo/commit/806d3b43bba3f3b4be6bdd0a99293062c571ef52)) (@df-wg)

## [0.168.1](https://github.com/wundergraph/cosmo/compare/router@0.168.0...router@0.168.1) (2025-01-30)

### Bug Fixes

* increase max concurrent resolvers ([#1544](https://github.com/wundergraph/cosmo/issues/1544)) ([00e2ee8](https://github.com/wundergraph/cosmo/commit/00e2ee831173eee25ecc21e4703667b22b779b4e)) (@StarpTech)

# [0.168.0](https://github.com/wundergraph/cosmo/compare/router@0.167.0...router@0.168.0) (2025-01-29)

### Features

* add normalizedQuery to query plan and request info to trace ([#1536](https://github.com/wundergraph/cosmo/issues/1536)) ([60e3d0e](https://github.com/wundergraph/cosmo/commit/60e3d0e7d406eea103268306973425a4e4c82222)) (@alepane21)

# [0.167.0](https://github.com/wundergraph/cosmo/compare/router@0.166.0...router@0.167.0) (2025-01-27)

### Features

* also add handshake for static execution configs ([#1535](https://github.com/wundergraph/cosmo/issues/1535)) ([f3f8fef](https://github.com/wundergraph/cosmo/commit/f3f8fef1d605fa1f3c6ac0a6bf6e7667ee8ec900)) (@Aenimus)
* **router:** add interface for trace propagation ([#1526](https://github.com/wundergraph/cosmo/issues/1526)) ([90005c5](https://github.com/wundergraph/cosmo/commit/90005c52e6d38096a9a6a6350c9c8c492eefe5b8)) (@Noroth)

# [0.166.0](https://github.com/wundergraph/cosmo/compare/router@0.165.1...router@0.166.0) (2025-01-24)

### Features

* add compatibility handshake between router and execution config ([#1534](https://github.com/wundergraph/cosmo/issues/1534)) ([4b8d60a](https://github.com/wundergraph/cosmo/commit/4b8d60ac48e1777069d68407ce72ea1d813155ca)) (@Aenimus)

## [0.165.1](https://github.com/wundergraph/cosmo/compare/router@0.165.0...router@0.165.1) (2025-01-23)

### Bug Fixes

* remove semaphore from ResolveGraphQLSubscription ([#1532](https://github.com/wundergraph/cosmo/issues/1532)) ([3b3a870](https://github.com/wundergraph/cosmo/commit/3b3a870ad21029b70b5985194948f5f170c38855)) (@alepane21)

# [0.165.0](https://github.com/wundergraph/cosmo/compare/router@0.164.1...router@0.165.0) (2025-01-23)

### Bug Fixes

* **router:** enable health checks during startup ([#1529](https://github.com/wundergraph/cosmo/issues/1529)) ([d56dfb6](https://github.com/wundergraph/cosmo/commit/d56dfb60ec8d8aaa5918816a07008d2d866d8a74)) (@Noroth)

### Features

* improve cache warmer ([#1530](https://github.com/wundergraph/cosmo/issues/1530)) ([2e3f0d2](https://github.com/wundergraph/cosmo/commit/2e3f0d2f05f0ecd8c2a39fd1588c5610af22eaed)) (@StarpTech)
* **router:** optimize playground delivery, add concurrency_limit to config ([#1519](https://github.com/wundergraph/cosmo/issues/1519)) ([1d7047b](https://github.com/wundergraph/cosmo/commit/1d7047b7dad07ceda591ae1368d94732c85241c6)) (@df-wg)

## [0.164.1](https://github.com/wundergraph/cosmo/compare/router@0.164.0...router@0.164.1) (2025-01-20)

### Bug Fixes

* **router:** write proper line endings and header for multipart ([#1517](https://github.com/wundergraph/cosmo/issues/1517)) ([c09ecf4](https://github.com/wundergraph/cosmo/commit/c09ecf4ba01977fc1e8bef9383d68600a5d886f9)) (@df-wg)

# [0.164.0](https://github.com/wundergraph/cosmo/compare/router@0.163.1...router@0.164.0) (2025-01-19)

### Features

* add variables remapping support ([#1516](https://github.com/wundergraph/cosmo/issues/1516)) ([6bb1231](https://github.com/wundergraph/cosmo/commit/6bb12312db92a0ecbe9907dc3e36ff8b515fa2c4)) (@devsergiy)

## [0.163.1](https://github.com/wundergraph/cosmo/compare/router@0.163.0...router@0.163.1) (2025-01-19)

### Bug Fixes

* **cache operation:** swallow cache errors and other improvements ([#1515](https://github.com/wundergraph/cosmo/issues/1515)) ([d959e2c](https://github.com/wundergraph/cosmo/commit/d959e2c9fb492cc7c73d89f61c31f3bad2ac5706)) (@StarpTech)

# [0.163.0](https://github.com/wundergraph/cosmo/compare/router@0.162.0...router@0.163.0) (2025-01-17)

### Bug Fixes

* **router:** remove wildcard from router graphql path ([#1509](https://github.com/wundergraph/cosmo/issues/1509)) ([e6f4b9b](https://github.com/wundergraph/cosmo/commit/e6f4b9bf9d642d39933528dd1654a9c9d969e565)) (@Noroth)
* use gauge for server.uptime metric ([#1510](https://github.com/wundergraph/cosmo/issues/1510)) ([77a16d2](https://github.com/wundergraph/cosmo/commit/77a16d203f04ef8d93878e5f28f6e08575313145)) (@StarpTech)

### Features

* cache warmer ([#1501](https://github.com/wundergraph/cosmo/issues/1501)) ([948edd2](https://github.com/wundergraph/cosmo/commit/948edd23e6d0ee968c91edd1a9e9943c3405ac2d)) (@JivusAyrus)

# [0.162.0](https://github.com/wundergraph/cosmo/compare/router@0.161.1...router@0.162.0) (2025-01-11)

### Bug Fixes

* add edfs to the demo environment ([#1505](https://github.com/wundergraph/cosmo/issues/1505)) ([2a70c94](https://github.com/wundergraph/cosmo/commit/2a70c94246aa120ea836f658733190b31fc9175f)) (@alepane21)
* full demo broken in main branch ([#1508](https://github.com/wundergraph/cosmo/issues/1508)) ([beab806](https://github.com/wundergraph/cosmo/commit/beab806571f5a760fc899e10d7742ca606cd031d)) (@alepane21)

### Features

* **router:** optionally add jitter to config polling interval ([#1506](https://github.com/wundergraph/cosmo/issues/1506)) ([1d67742](https://github.com/wundergraph/cosmo/commit/1d677429e3fae397d4c1e03cd69636521bbe80c8)) (@endigma)

## [0.161.1](https://github.com/wundergraph/cosmo/compare/router@0.161.0...router@0.161.1) (2025-01-08)

### Bug Fixes

* provider should be specified in the config.yaml ([#1397](https://github.com/wundergraph/cosmo/issues/1397)) ([7f0f4bb](https://github.com/wundergraph/cosmo/commit/7f0f4bba0b8a1f09787d4cd8f0943a4de761ebb4)) (@alepane21)

# [0.161.0](https://github.com/wundergraph/cosmo/compare/router@0.160.0...router@0.161.0) (2025-01-08)

### Features

* improve rate limit responses (add code, hide stats) ([#1497](https://github.com/wundergraph/cosmo/issues/1497)) ([73ed728](https://github.com/wundergraph/cosmo/commit/73ed728424c07c02733988d2f9a7ca1f96b522e7)) (@jensneuse)

# [0.160.0](https://github.com/wundergraph/cosmo/compare/router@0.159.1...router@0.160.0) (2025-01-07)

### Bug Fixes

* bump timeout in server to address responseheadertimeout flake ([#1493](https://github.com/wundergraph/cosmo/issues/1493)) ([c2f2131](https://github.com/wundergraph/cosmo/commit/c2f2131ca12a9ca830a9a675c3b6b1493c618247)) (@df-wg)

### Features

* improve rate limiting with better customization ([#1476](https://github.com/wundergraph/cosmo/issues/1476)) ([ffcb634](https://github.com/wundergraph/cosmo/commit/ffcb63426bf123568edaa206c2a4736ff48ebfe9)) (@jensneuse)
* return error when subgraphs return incompatible results ([#1490](https://github.com/wundergraph/cosmo/issues/1490)) ([7c4f209](https://github.com/wundergraph/cosmo/commit/7c4f209ffc33fb98f87ce24b87b96847d934e664)) (@jensneuse)

## [0.159.1](https://github.com/wundergraph/cosmo/compare/router@0.159.0...router@0.159.1) (2025-01-06)

### Bug Fixes

* add regex validation to graph names and routing urls ([#1450](https://github.com/wundergraph/cosmo/issues/1450)) ([e5b1c8f](https://github.com/wundergraph/cosmo/commit/e5b1c8fb33a41fc808067bb6495a43f74b60b314)) (@JivusAyrus)

# [0.159.0](https://github.com/wundergraph/cosmo/compare/router@0.158.0...router@0.159.0) (2025-01-06)

### Bug Fixes

* **expressions:** avoid exposing more methods as desired ([#1486](https://github.com/wundergraph/cosmo/issues/1486)) ([105e7ab](https://github.com/wundergraph/cosmo/commit/105e7ab52dfe6a4927697846bc2f0dc0779ca0b8)) (@StarpTech)
* **router:** ensure persisted operation hits both with and without op name ([#1478](https://github.com/wundergraph/cosmo/issues/1478)) ([91ee80f](https://github.com/wundergraph/cosmo/commit/91ee80f8017865cd3dc19a75c8b6d73ce54fb9d9)) (@df-wg)
* use gauge metric type for router uptime metric ([#1485](https://github.com/wundergraph/cosmo/issues/1485)) ([94b0125](https://github.com/wundergraph/cosmo/commit/94b01252d6be2848b98449fb29a0bd63dcd980d3)) (@StarpTech)

### Features

* allow to conditionally block mutation via expressions ([#1480](https://github.com/wundergraph/cosmo/issues/1480)) ([750f7dc](https://github.com/wundergraph/cosmo/commit/750f7dc107304c7d0e1f0a9b3f76e89ba00c8d93)) (@StarpTech)
* **jwk:** upgrade JWK library, ensure tokens are validated, retry on network issues ([#1488](https://github.com/wundergraph/cosmo/issues/1488)) ([faab120](https://github.com/wundergraph/cosmo/commit/faab1205f1b9f1f8684d26c23191be14514c1cf8)) (@StarpTech)
* **router:** expose engine statistic metrics ([#1452](https://github.com/wundergraph/cosmo/issues/1452)) ([00d0c87](https://github.com/wundergraph/cosmo/commit/00d0c8735c0644a41ff539982acaa3106d612b9e)) (@Noroth)
* **router:** remove default high cardinality attributes ([#1448](https://github.com/wundergraph/cosmo/issues/1448)) ([fd66346](https://github.com/wundergraph/cosmo/commit/fd66346de38a3ae8cc25dcf575e387ac77ce24e9)) (@Noroth)
* speed up router-tests ([#1428](https://github.com/wundergraph/cosmo/issues/1428)) ([8a7d8cf](https://github.com/wundergraph/cosmo/commit/8a7d8cfcacd6c1dbd40037b99f67e19b9e83950f)) (@alepane21)

# [0.158.0](https://github.com/wundergraph/cosmo/compare/router@0.157.0...router@0.158.0) (2024-12-23)

### Features

* tolerate initial JWK error ([#1475](https://github.com/wundergraph/cosmo/issues/1475)) ([57e8507](https://github.com/wundergraph/cosmo/commit/57e85079c59454137463d52eccbcb246e8fdac84)) (@StarpTech)

# [0.157.0](https://github.com/wundergraph/cosmo/compare/router@0.156.0...router@0.157.0) (2024-12-21)

### Features

* upgrade go to 1.23 ([#1473](https://github.com/wundergraph/cosmo/issues/1473)) ([4c29d2d](https://github.com/wundergraph/cosmo/commit/4c29d2d358c2b716a33e35505b080b9be2e1fce3)) (@StarpTech)

# [0.156.0](https://github.com/wundergraph/cosmo/compare/router@0.155.0...router@0.156.0) (2024-12-20)

### Features

* **router:** make header size configurable ([#1457](https://github.com/wundergraph/cosmo/issues/1457)) ([9d3ca55](https://github.com/wundergraph/cosmo/commit/9d3ca55150295e637f419bed31c84d139916fff2)) (@Noroth)

# [0.155.0](https://github.com/wundergraph/cosmo/compare/router@0.154.0...router@0.155.0) (2024-12-18)

### Features

* implement cache warmup using filesystem ([#1437](https://github.com/wundergraph/cosmo/issues/1437)) ([1efd072](https://github.com/wundergraph/cosmo/commit/1efd0720febd27cd328a189c7757036b28e3d81b)) (@jensneuse)

# [0.154.0](https://github.com/wundergraph/cosmo/compare/router@0.153.2...router@0.154.0) (2024-12-18)

### Features

* **router:** support traffic shaping rules on subgraph level ([#1438](https://github.com/wundergraph/cosmo/issues/1438)) ([45a1189](https://github.com/wundergraph/cosmo/commit/45a1189c19d7b41ffebd62230f1ab9276544fd0a)) (@df-wg)

## [0.153.2](https://github.com/wundergraph/cosmo/compare/router@0.153.1...router@0.153.2) (2024-12-17)

### Bug Fixes

* router playground cursor visibility ([#1451](https://github.com/wundergraph/cosmo/issues/1451)) ([73b82da](https://github.com/wundergraph/cosmo/commit/73b82dafff85e9ba4ead8bccaa180e70fdf7f6ce)) (@thisisnithin)

## [0.153.1](https://github.com/wundergraph/cosmo/compare/router@0.153.0...router@0.153.1) (2024-12-17)

### Bug Fixes

* **router:** ensure subgraph timeouts/nil responses are handled correctly ([#1449](https://github.com/wundergraph/cosmo/issues/1449)) ([5402152](https://github.com/wundergraph/cosmo/commit/540215241eeecf8630e092c1864d50443e71967d)) (@df-wg)

# [0.153.0](https://github.com/wundergraph/cosmo/compare/router@0.152.1...router@0.153.0) (2024-12-17)

### Features

* edfs nats create bespoke consumer ([#1443](https://github.com/wundergraph/cosmo/issues/1443)) ([af97af7](https://github.com/wundergraph/cosmo/commit/af97af71af0eb2de20dd5a0e0bc8cc454f1b0e38)) (@alepane21)

## [0.152.1](https://github.com/wundergraph/cosmo/compare/router@0.152.0...router@0.152.1) (2024-12-16)

### Bug Fixes

* don't re-use buffer for reading requests ([#1447](https://github.com/wundergraph/cosmo/issues/1447)) ([3262622](https://github.com/wundergraph/cosmo/commit/32626221aae9f6e3cf3af56797be67993f17cca3)) (@jensneuse)

# [0.152.0](https://github.com/wundergraph/cosmo/compare/router@0.151.1...router@0.152.0) (2024-12-16)

### Bug Fixes

* **router:** ensure subgraph access logs handles null requests/errors ([#1445](https://github.com/wundergraph/cosmo/issues/1445)) ([909967e](https://github.com/wundergraph/cosmo/commit/909967eb02e66f859c9aeae0818675756166a215)) (@df-wg)

### Features

* implement otel cardinality limit ([#1423](https://github.com/wundergraph/cosmo/issues/1423)) ([c31c563](https://github.com/wundergraph/cosmo/commit/c31c563d3cd82b6da3c3bba7cbfdb4674077ba7c)) (@Noroth)

## [0.151.1](https://github.com/wundergraph/cosmo/compare/router@0.151.0...router@0.151.1) (2024-12-12)

### Bug Fixes

* **APQ:** set normalization cache hit stat correctly ([#1435](https://github.com/wundergraph/cosmo/issues/1435)) ([8a6b0d7](https://github.com/wundergraph/cosmo/commit/8a6b0d7fab8c6e8c17990f911b27ec8f084451f4)) (@StarpTech)
* panic when normalizing multi operation documents ([#1433](https://github.com/wundergraph/cosmo/issues/1433)) ([a017b71](https://github.com/wundergraph/cosmo/commit/a017b71529b82c828f03aac4ac5a3760b81391d5)) (@StarpTech)
* **router:** add missing telemetry config ([#1436](https://github.com/wundergraph/cosmo/issues/1436)) ([be6d144](https://github.com/wundergraph/cosmo/commit/be6d144a73dccebfe5a39de16135e166033e8590)) (@Noroth)

# [0.151.0](https://github.com/wundergraph/cosmo/compare/router@0.150.0...router@0.151.0) (2024-12-11)

### Features

* add error message on invalid JSON in edfs message ([#1415](https://github.com/wundergraph/cosmo/issues/1415)) ([9d181e9](https://github.com/wundergraph/cosmo/commit/9d181e92be3cf332ce45b63c833e4f710c27f542)) (@alepane21)
* ensure consistent hash for operations ([#1367](https://github.com/wundergraph/cosmo/issues/1367)) ([9e516e4](https://github.com/wundergraph/cosmo/commit/9e516e4eff01d166a7a282eb562aead23aa6b6dd)) (@StarpTech)

# [0.150.0](https://github.com/wundergraph/cosmo/compare/router@0.149.0...router@0.150.0) (2024-12-10)

### Features

* query plan for subscriptions ([#1425](https://github.com/wundergraph/cosmo/issues/1425)) ([fc88e1b](https://github.com/wundergraph/cosmo/commit/fc88e1b3620a019acb5976b19787a91a79916b7a)) (@thisisnithin)

# [0.149.0](https://github.com/wundergraph/cosmo/compare/router@0.148.0...router@0.149.0) (2024-12-09)

### Features

* initial access log improvements ([#1424](https://github.com/wundergraph/cosmo/issues/1424)) ([5c95e36](https://github.com/wundergraph/cosmo/commit/5c95e369188e5ef034fc59447f910fffe15bc998)) (@df-wg)
* **router:** add request_error boolean field to access logs ([#1421](https://github.com/wundergraph/cosmo/issues/1421)) ([6f7bd37](https://github.com/wundergraph/cosmo/commit/6f7bd370e605258bd531c74c6154a33894879d09)) (@df-wg)

# [0.148.0](https://github.com/wundergraph/cosmo/compare/router@0.147.0...router@0.148.0) (2024-12-06)

### Bug Fixes

* update default value for subgraph fetch operation name ([#1422](https://github.com/wundergraph/cosmo/issues/1422)) ([1854c6d](https://github.com/wundergraph/cosmo/commit/1854c6d33995e0e8177908eda347f68c76b2138a)) (@Noroth)
* update packages to address vulnerabilities ([#1411](https://github.com/wundergraph/cosmo/issues/1411)) ([7e84900](https://github.com/wundergraph/cosmo/commit/7e84900ed705164d69c99afcf5a698b3298fb6ad)) (@JivusAyrus)

### Features

* use configurable heartbeat to speed up tests ([#1418](https://github.com/wundergraph/cosmo/issues/1418)) ([f2ef4ab](https://github.com/wundergraph/cosmo/commit/f2ef4ab97424d892a77e4ed37d0b14ec4ca55bcc)) (@df-wg)

# [0.147.0](https://github.com/wundergraph/cosmo/compare/router@0.146.1...router@0.147.0) (2024-12-05)

### Features

* add NATS reconnect handling ([#1419](https://github.com/wundergraph/cosmo/issues/1419)) ([babb47c](https://github.com/wundergraph/cosmo/commit/babb47c415f977416d993f7a3278307ae32459fd)) (@Aenimus)

## [0.146.1](https://github.com/wundergraph/cosmo/compare/router@0.146.0...router@0.146.1) (2024-12-03)

### Bug Fixes

* disable query plan for subscriptions ([#1417](https://github.com/wundergraph/cosmo/issues/1417)) ([7cdad41](https://github.com/wundergraph/cosmo/commit/7cdad413861535c78f8b664d2dbe4750e16770fb)) (@thisisnithin)

# [0.146.0](https://github.com/wundergraph/cosmo/compare/router@0.145.1...router@0.146.0) (2024-12-03)

### Bug Fixes

* ignore internal cost for ristretto caches ([#1413](https://github.com/wundergraph/cosmo/issues/1413)) ([94c9623](https://github.com/wundergraph/cosmo/commit/94c9623b3b10449de2075dff149640809cafb52a)) (@Noroth)
* race on client request stop ([#1410](https://github.com/wundergraph/cosmo/issues/1410)) ([f732675](https://github.com/wundergraph/cosmo/commit/f7326756f1f947bde263f39c83510aae7b601074)) (@jensneuse)
* **router:** use valid format for graphql operation ([#1406](https://github.com/wundergraph/cosmo/issues/1406)) ([93088ba](https://github.com/wundergraph/cosmo/commit/93088babaebc8b6f9d7536f1bc07843731dd569b)) (@Noroth)

### Features

* add subgraph access logs ([#1401](https://github.com/wundergraph/cosmo/issues/1401)) ([c52b2b0](https://github.com/wundergraph/cosmo/commit/c52b2b013d642e79d4c80df6ed4aae6656cb3c9e)) (@df-wg)
* **router:** expose router operation cache metrics ([#1408](https://github.com/wundergraph/cosmo/issues/1408)) ([801f0b1](https://github.com/wundergraph/cosmo/commit/801f0b1089db670166371d25762b817aebbcda4f)) (@Noroth)

## [0.145.1](https://github.com/wundergraph/cosmo/compare/router@0.145.0...router@0.145.1) (2024-11-27)

### Bug Fixes

* have enable_subgraph_fetch_operation_name default to false ([#1405](https://github.com/wundergraph/cosmo/issues/1405)) ([26cdadc](https://github.com/wundergraph/cosmo/commit/26cdadc1503f04cb10e1e0aed6b646dce5b500f0)) (@df-wg)

# [0.145.0](https://github.com/wundergraph/cosmo/compare/router@0.144.1...router@0.145.0) (2024-11-27)

### Bug Fixes

* ensure that apq alone (without persistent operations enabled) works ([#1402](https://github.com/wundergraph/cosmo/issues/1402)) ([0681d60](https://github.com/wundergraph/cosmo/commit/0681d60a5f89826813963c848773c42b4e998121)) (@df-wg)
* move runtime metric store to graph server ([#1400](https://github.com/wundergraph/cosmo/issues/1400)) ([1e00f4b](https://github.com/wundergraph/cosmo/commit/1e00f4b55fb5c7d624010a6e672aba7dad317c68)) (@StarpTech)

### Features

* **router:** allow operation name propagation ([#1394](https://github.com/wundergraph/cosmo/issues/1394)) ([7aa6a20](https://github.com/wundergraph/cosmo/commit/7aa6a20a4008507d6a344830663a789531947f44)) (@Noroth)

## [0.144.1](https://github.com/wundergraph/cosmo/compare/router@0.144.0...router@0.144.1) (2024-11-24)

### Bug Fixes

* ensure metric emission even when slice attr is empty ([#1395](https://github.com/wundergraph/cosmo/issues/1395)) ([f576641](https://github.com/wundergraph/cosmo/commit/f576641b2ece9ffb18e81ed0d67137e209aace2a)) (@StarpTech)

# [0.144.0](https://github.com/wundergraph/cosmo/compare/router@0.143.3...router@0.144.0) (2024-11-21)

### Features

* **router:** add ability to set auth scopes in custom module ([#1390](https://github.com/wundergraph/cosmo/issues/1390)) ([251f1d5](https://github.com/wundergraph/cosmo/commit/251f1d506b0fdc939c456daf247742775f0e12ce)) (@df-wg)

## [0.143.3](https://github.com/wundergraph/cosmo/compare/router@0.143.2...router@0.143.3) (2024-11-19)

### Bug Fixes

* upgrade engine to fix fd issue with TLS connections ([#1388](https://github.com/wundergraph/cosmo/issues/1388)) ([7c8bb55](https://github.com/wundergraph/cosmo/commit/7c8bb55d074d732180f433eb6ac3b6139f4416c0)) (@StarpTech)

## [0.143.2](https://github.com/wundergraph/cosmo/compare/router@0.143.1...router@0.143.2) (2024-11-18)

### Bug Fixes

* fix regression on removing null variables which was undefined ([#1385](https://github.com/wundergraph/cosmo/issues/1385)) ([475d58e](https://github.com/wundergraph/cosmo/commit/475d58eb79b693b4cee9f561d0694d392152faf8)) (@devsergiy)

## [0.143.1](https://github.com/wundergraph/cosmo/compare/router@0.143.0...router@0.143.1) (2024-11-18)

### Bug Fixes

* do netPoll detection once and set it globally ([#1384](https://github.com/wundergraph/cosmo/issues/1384)) ([2cba138](https://github.com/wundergraph/cosmo/commit/2cba13896e2f46dee127071d0777a6bff65e21b6)) (@StarpTech)

# [0.143.0](https://github.com/wundergraph/cosmo/compare/router@0.142.1...router@0.143.0) (2024-11-18)

### Bug Fixes

* **router:** ensure that cors wildcard support is enabled ([#1375](https://github.com/wundergraph/cosmo/issues/1375)) ([fde6885](https://github.com/wundergraph/cosmo/commit/fde68852e3cabae372a80620d8846b30a0038ea3)) (@df-wg)

### Features

* better epoll detection, allow to disable epoll ([#1381](https://github.com/wundergraph/cosmo/issues/1381)) ([6c3c4a0](https://github.com/wundergraph/cosmo/commit/6c3c4a0e5170f964e3f3145bb31d50eb11886932)) (@StarpTech)

## [0.142.1](https://github.com/wundergraph/cosmo/compare/router@0.142.0...router@0.142.1) (2024-11-16)

### Bug Fixes

* **tests:** deadlock on unsubscribe when epoll disabled ([#1380](https://github.com/wundergraph/cosmo/issues/1380)) ([337a60f](https://github.com/wundergraph/cosmo/commit/337a60f15577b373ca67a83497304d53fe19f55d)) (@StarpTech)

# [0.142.0](https://github.com/wundergraph/cosmo/compare/router@0.141.3...router@0.142.0) (2024-11-15)

### Bug Fixes

* **router:** refactor complexity limits ([#1364](https://github.com/wundergraph/cosmo/issues/1364)) ([9558ece](https://github.com/wundergraph/cosmo/commit/9558ece2d892dab1b310e0ff5f4b9b9029abf297)) (@df-wg)

### Features

* **router:** enable setting request header from context ([#1371](https://github.com/wundergraph/cosmo/issues/1371)) ([c96485d](https://github.com/wundergraph/cosmo/commit/c96485d0635c301e89773e3736dd00372bcd3fd5)) (@df-wg)

## [0.141.3](https://github.com/wundergraph/cosmo/compare/router@0.141.2...router@0.141.3) (2024-11-14)

### Bug Fixes

* fix merging of response nodes of enum type ([#1373](https://github.com/wundergraph/cosmo/issues/1373)) ([f3927e3](https://github.com/wundergraph/cosmo/commit/f3927e3cfc382bff9beff0a7868b444db213b9d6)) (@devsergiy)

## [0.141.2](https://github.com/wundergraph/cosmo/compare/router@0.141.1...router@0.141.2) (2024-11-12)

### Bug Fixes

* variables normalization for the anonymous operations ([#1365](https://github.com/wundergraph/cosmo/issues/1365)) ([0b8ff06](https://github.com/wundergraph/cosmo/commit/0b8ff06592954bef2329fa69a660c60e55e4eb3d)) (@devsergiy)

## [0.141.1](https://github.com/wundergraph/cosmo/compare/router@0.141.0...router@0.141.1) (2024-11-12)

### Bug Fixes

* **router:** use OTLP separators for regex ([#1362](https://github.com/wundergraph/cosmo/issues/1362)) ([e9dd4ac](https://github.com/wundergraph/cosmo/commit/e9dd4ac01c864afbde533f5b70da920ac460086f)) (@Noroth)

# [0.141.0](https://github.com/wundergraph/cosmo/compare/router@0.140.2...router@0.141.0) (2024-11-12)

### Bug Fixes

* enable redis url injection via env var, allow apq from diff clients ([#1361](https://github.com/wundergraph/cosmo/issues/1361)) ([a123088](https://github.com/wundergraph/cosmo/commit/a1230886626b9412422fcfd8dca70be330488c68)) (@df-wg)

### Features

* **router:** allow exclusion of OTLP metrics via configuration ([#1359](https://github.com/wundergraph/cosmo/issues/1359)) ([31a583e](https://github.com/wundergraph/cosmo/commit/31a583e009cb2ea748f77b0d3e3240f9073291aa)) (@Noroth)
* **router:** allow users to have multiple wildcards cores allow_origins ([#1358](https://github.com/wundergraph/cosmo/issues/1358)) ([8735f50](https://github.com/wundergraph/cosmo/commit/8735f50620c06a61540f4b94b191a2db0a2fac9b)) (@df-wg)

## [0.140.2](https://github.com/wundergraph/cosmo/compare/router@0.140.1...router@0.140.2) (2024-11-08)

### Bug Fixes

* json parsing and input templates rendering ([#1350](https://github.com/wundergraph/cosmo/issues/1350)) ([578a408](https://github.com/wundergraph/cosmo/commit/578a4085862b3149dbbfb10362aff118c62dfff2)) (@jensneuse)
* **router:** don't flush all redis keys while shutdown ([#1349](https://github.com/wundergraph/cosmo/issues/1349)) ([9f37105](https://github.com/wundergraph/cosmo/commit/9f371059ec9608fce5f9da8c72246604b46fd34d)) (@git-hulk)

## [0.140.1](https://github.com/wundergraph/cosmo/compare/router@0.140.0...router@0.140.1) (2024-11-08)

### Bug Fixes

* default metric temporality selector and override the selector for the cloud endpoint ([#1331](https://github.com/wundergraph/cosmo/issues/1331)) ([2a292ea](https://github.com/wundergraph/cosmo/commit/2a292eaec75624282becec7b84c9b57ab37a5f50)) (@JivusAyrus)
* **router:** l2 cache uses client name in key, persisted operation not found returns 200 ([#1351](https://github.com/wundergraph/cosmo/issues/1351)) ([34cf5b5](https://github.com/wundergraph/cosmo/commit/34cf5b5c7f58b698c032c159c24cdda1cfe1bbdf)) (@df-wg)

# [0.140.0](https://github.com/wundergraph/cosmo/compare/router@0.139.2...router@0.140.0) (2024-11-07)

### Features

* add apq back in ([#1346](https://github.com/wundergraph/cosmo/issues/1346)) ([61c0d9b](https://github.com/wundergraph/cosmo/commit/61c0d9b9ac383ad744d47a461fc7ac9b07c9c981)) (@df-wg)

## [0.139.2](https://github.com/wundergraph/cosmo/compare/router@0.139.1...router@0.139.2) (2024-11-07)

**Note:** Version bump only for package router

## [0.139.1](https://github.com/wundergraph/cosmo/compare/router@0.139.0...router@0.139.1) (2024-11-06)

### Bug Fixes

* revert APQ due to memory leak ([#1340](https://github.com/wundergraph/cosmo/issues/1340)) ([a1bfdcc](https://github.com/wundergraph/cosmo/commit/a1bfdcc4e1cab906d45c8e0b0d8a507811c26231)) (@StarpTech)

# [0.139.0](https://github.com/wundergraph/cosmo/compare/router@0.138.0...router@0.139.0) (2024-11-06)

### Bug Fixes

* fix goccy ([#1339](https://github.com/wundergraph/cosmo/issues/1339)) ([99f9e29](https://github.com/wundergraph/cosmo/commit/99f9e29f6030af23ae1c7f08640cbc1f62f84dad)) (@df-wg)

### Features

* **router:** implement automatic persistent queries (apq) ([#1330](https://github.com/wundergraph/cosmo/issues/1330)) ([133ea40](https://github.com/wundergraph/cosmo/commit/133ea404e4b422b0de3e812e79abbe3cf6748021)) (@df-wg)

# [0.138.0](https://github.com/wundergraph/cosmo/compare/router@0.137.1...router@0.138.0) (2024-11-05)

### Bug Fixes

* playground scripts inconsistent states ([#1337](https://github.com/wundergraph/cosmo/issues/1337)) ([73309eb](https://github.com/wundergraph/cosmo/commit/73309eb1f492246f9488b192f5956da24d4ebe5f)) (@thisisnithin)

### Features

* context handling performance & memory improvements ([#1336](https://github.com/wundergraph/cosmo/issues/1336)) ([1aed39a](https://github.com/wundergraph/cosmo/commit/1aed39a99d604595ca4fef711a45ef0b059f77a5)) (@jensneuse)

## [0.137.1](https://github.com/wundergraph/cosmo/compare/router@0.137.0...router@0.137.1) (2024-11-04)

### Bug Fixes

* **prometheus:** reduce buckets to prevent cardinality issues ([#1329](https://github.com/wundergraph/cosmo/issues/1329)) ([a3b80f0](https://github.com/wundergraph/cosmo/commit/a3b80f0a0a9606d26c1b5a9d9b5f50062cdc93bc)) (@StarpTech)

# [0.137.0](https://github.com/wundergraph/cosmo/compare/router@0.136.2...router@0.137.0) (2024-11-04)

### Features

* **telemetry:** improve memory consumption ([#1328](https://github.com/wundergraph/cosmo/issues/1328)) ([2b361ee](https://github.com/wundergraph/cosmo/commit/2b361eee737ff8904890146442bc402acf29e8ed)) (@StarpTech)

## [0.136.2](https://github.com/wundergraph/cosmo/compare/router@0.136.1...router@0.136.2) (2024-11-04)

### Bug Fixes

* playground undefined and callee error ([#1333](https://github.com/wundergraph/cosmo/issues/1333)) ([4b07060](https://github.com/wundergraph/cosmo/commit/4b0706080da881aadda1c8cd8577cbdccbf86494)) (@thisisnithin)

## [0.136.1](https://github.com/wundergraph/cosmo/compare/router@0.136.0...router@0.136.1) (2024-11-04)

**Note:** Version bump only for package router

# [0.136.0](https://github.com/wundergraph/cosmo/compare/router@0.135.0...router@0.136.0) (2024-10-31)

### Features

* allow to override metric temporarity per exporter ([#1321](https://github.com/wundergraph/cosmo/issues/1321)) ([b67fcba](https://github.com/wundergraph/cosmo/commit/b67fcba35671abd6d224e5fc5a5ce02608c0c250)) (@JivusAyrus)

# [0.135.0](https://github.com/wundergraph/cosmo/compare/router@0.134.1...router@0.135.0) (2024-10-31)

### Features

* custom scripts ([#1302](https://github.com/wundergraph/cosmo/issues/1302)) ([9f4457c](https://github.com/wundergraph/cosmo/commit/9f4457c7f7acdf2f56cc3ad7f0474653063f290c)) (@thisisnithin)
* provide pprof support in default distribution ([#1323](https://github.com/wundergraph/cosmo/issues/1323)) ([2562b9b](https://github.com/wundergraph/cosmo/commit/2562b9bd7005b0858e3d01a2fc38f855309213d5)) (@StarpTech)

## [0.134.1](https://github.com/wundergraph/cosmo/compare/router@0.134.0...router@0.134.1) (2024-10-29)

### Bug Fixes

* propagate new yaml properties in schema.json ([#1322](https://github.com/wundergraph/cosmo/issues/1322)) ([290cf9f](https://github.com/wundergraph/cosmo/commit/290cf9f6bb08e71ec3d1734f40ce2aa7a745a7bd)) (@Aenimus)

# [0.134.0](https://github.com/wundergraph/cosmo/compare/router@0.133.1...router@0.134.0) (2024-10-29)

### Features

* extend apollo compatible error support ([#1311](https://github.com/wundergraph/cosmo/issues/1311)) ([d4d727e](https://github.com/wundergraph/cosmo/commit/d4d727e1c98f92eaa2103ca2356537e3a63eeff2)) (@Aenimus)

## [0.133.1](https://github.com/wundergraph/cosmo/compare/router@0.133.0...router@0.133.1) (2024-10-29)

### Bug Fixes

* **access-logs:** default value is not respected without value_from ([#1320](https://github.com/wundergraph/cosmo/issues/1320)) ([a48ae95](https://github.com/wundergraph/cosmo/commit/a48ae952c81a9ad673ee12a8b84edab268d91878)) (@StarpTech)

# [0.133.0](https://github.com/wundergraph/cosmo/compare/router@0.132.0...router@0.133.0) (2024-10-28)

### Features

* **router:** consider public and private directives for cache control ([#1314](https://github.com/wundergraph/cosmo/issues/1314)) ([f0da638](https://github.com/wundergraph/cosmo/commit/f0da638f9c51c83a220fffb781f229655429cbe2)) (@df-wg)

# [0.132.0](https://github.com/wundergraph/cosmo/compare/router@0.131.2...router@0.132.0) (2024-10-28)

### Features

* upgrade go tools to support lock free epoll conn handling for ws origin requests ([#1316](https://github.com/wundergraph/cosmo/issues/1316)) ([f3f23d6](https://github.com/wundergraph/cosmo/commit/f3f23d6686a241a38700ff9b0ce8c5fe6a41582f)) (@jensneuse)

## [0.131.2](https://github.com/wundergraph/cosmo/compare/router@0.131.1...router@0.131.2) (2024-10-27)

### Bug Fixes

* **epoll:** don't return when client conn was terminated ([#1312](https://github.com/wundergraph/cosmo/issues/1312)) ([63f17d6](https://github.com/wundergraph/cosmo/commit/63f17d63b2f2c578fbf79aef56e4bc7a3631116e)) (@StarpTech)

## [0.131.1](https://github.com/wundergraph/cosmo/compare/router@0.131.0...router@0.131.1) (2024-10-25)

**Note:** Version bump only for package router

# [0.131.0](https://github.com/wundergraph/cosmo/compare/router@0.130.2...router@0.131.0) (2024-10-25)

### Features

* add origin subgraph request epoll support ([#1284](https://github.com/wundergraph/cosmo/issues/1284)) ([4fe8146](https://github.com/wundergraph/cosmo/commit/4fe81461a43e45dbd3bae482976fec8127d3d982)) (@jensneuse)

## [0.130.2](https://github.com/wundergraph/cosmo/compare/router@0.130.1...router@0.130.2) (2024-10-24)

### Bug Fixes

* value completion typename, planner shared nodes selections ([#1306](https://github.com/wundergraph/cosmo/issues/1306)) ([b5929bf](https://github.com/wundergraph/cosmo/commit/b5929bfcd263e835efae617d3ca64691c44c7ff9)) (@devsergiy)

## [0.130.1](https://github.com/wundergraph/cosmo/compare/router@0.130.0...router@0.130.1) (2024-10-24)

### Bug Fixes

* exclude query plan fetches from field usage count ([#1297](https://github.com/wundergraph/cosmo/issues/1297)) ([437bc76](https://github.com/wundergraph/cosmo/commit/437bc764fb83087d036f89243d0ef2365ed2a67f)) (@JivusAyrus)
* trace id in logs from custom modules ([#1299](https://github.com/wundergraph/cosmo/issues/1299)) ([60021ee](https://github.com/wundergraph/cosmo/commit/60021ee54170de6d8298eb84279a0be6777ac1c0)) (@JivusAyrus)

# [0.130.0](https://github.com/wundergraph/cosmo/compare/router@0.129.2...router@0.130.0) (2024-10-22)

### Features

* add traceId to logs ([#1279](https://github.com/wundergraph/cosmo/issues/1279)) ([025da28](https://github.com/wundergraph/cosmo/commit/025da2888ea95dbb2de581d6affda76fdc74332a)) (@JivusAyrus)

## [0.129.2](https://github.com/wundergraph/cosmo/compare/router@0.129.1...router@0.129.2) (2024-10-22)

### Bug Fixes

* **websocket:** check for valid fd ([#1296](https://github.com/wundergraph/cosmo/issues/1296)) ([a7da8bc](https://github.com/wundergraph/cosmo/commit/a7da8bc678afecbfd600ffc3b672ac4aaa64da14)) (@StarpTech)

## [0.129.1](https://github.com/wundergraph/cosmo/compare/router@0.129.0...router@0.129.1) (2024-10-21)

### Bug Fixes

* return early when shared singleflight errored, log refactor for panics ([#1291](https://github.com/wundergraph/cosmo/issues/1291)) ([cefb78a](https://github.com/wundergraph/cosmo/commit/cefb78aa61f0a41a47020e0f799970bf072f1f27)) (@StarpTech)

# [0.129.0](https://github.com/wundergraph/cosmo/compare/router@0.128.2...router@0.129.0) (2024-10-21)

### Features

* include subgraph name in ART ([#1290](https://github.com/wundergraph/cosmo/issues/1290)) ([2acfc30](https://github.com/wundergraph/cosmo/commit/2acfc300a618b4fe8392df0633c6dd6c5bbe393a)) (@StarpTech)

## [0.128.2](https://github.com/wundergraph/cosmo/compare/router@0.128.1...router@0.128.2) (2024-10-20)

### Bug Fixes

* **websocket:** prevent ws headers leaking to the subgraph ws connection ([#1149](https://github.com/wundergraph/cosmo/issues/1149)) ([#1293](https://github.com/wundergraph/cosmo/issues/1293)) ([c27558f](https://github.com/wundergraph/cosmo/commit/c27558f40f2da3076a44eadd550ed55e9dfa9c28)) (@alepane21)

## [0.128.1](https://github.com/wundergraph/cosmo/compare/router@0.128.0...router@0.128.1) (2024-10-20)

### Bug Fixes

* **websocket:** set op name and operation ([#1289](https://github.com/wundergraph/cosmo/issues/1289)) ([b094898](https://github.com/wundergraph/cosmo/commit/b0948983049d6ed3b0f65b27e414a5c4413c032a)) (@StarpTech)

# [0.128.0](https://github.com/wundergraph/cosmo/compare/router@0.127.0...router@0.128.0) (2024-10-18)

### Features

* improve planning time ([#1287](https://github.com/wundergraph/cosmo/issues/1287)) ([c4ff4dd](https://github.com/wundergraph/cosmo/commit/c4ff4dda5bce0cf12429554d458304b92525e800)) (@devsergiy)

# [0.127.0](https://github.com/wundergraph/cosmo/compare/router@0.126.0...router@0.127.0) (2024-10-17)

### Features

* **tests:** add service and code when extensions is null or empty ([#1283](https://github.com/wundergraph/cosmo/issues/1283)) ([b220e81](https://github.com/wundergraph/cosmo/commit/b220e81148829c50dd7f710a2098dffe0260dc61)) (@StarpTech)

# [0.126.0](https://github.com/wundergraph/cosmo/compare/router@0.125.3...router@0.126.0) (2024-10-17)

### Features

* custom metric attributes ([#1267](https://github.com/wundergraph/cosmo/issues/1267)) ([f6a4224](https://github.com/wundergraph/cosmo/commit/f6a4224a2370e8eb6e36598a22f60a3eee83f055)) (@StarpTech)

## [0.125.3](https://github.com/wundergraph/cosmo/compare/router@0.125.2...router@0.125.3) (2024-10-16)

### Bug Fixes

* lower max concurrent resolver to 32 ([#1274](https://github.com/wundergraph/cosmo/issues/1274)) ([98f7554](https://github.com/wundergraph/cosmo/commit/98f7554190da50b5c58a6bb2841ef2c559aa73f4)) (@StarpTech)

## [0.125.2](https://github.com/wundergraph/cosmo/compare/router@0.125.1...router@0.125.2) (2024-10-16)

### Bug Fixes

* provides edge cases ([#1275](https://github.com/wundergraph/cosmo/issues/1275)) ([a5020b3](https://github.com/wundergraph/cosmo/commit/a5020b3f547306fc2a7e94855caeb9daf3732e78)) (@devsergiy)

## [0.125.1](https://github.com/wundergraph/cosmo/compare/router@0.125.0...router@0.125.1) (2024-10-15)

### Bug Fixes

* propagate ancestor exclude tags ([#1272](https://github.com/wundergraph/cosmo/issues/1272)) ([b008d45](https://github.com/wundergraph/cosmo/commit/b008d4510ca004839c2d746d05f4e3173b01d748)) (@Aenimus)

# [0.125.0](https://github.com/wundergraph/cosmo/compare/router@0.124.1...router@0.125.0) (2024-10-14)

### Bug Fixes

* ensure sse is spec compliant ([#1260](https://github.com/wundergraph/cosmo/issues/1260)) ([d64d383](https://github.com/wundergraph/cosmo/commit/d64d38329ab3963f54aff3819b532272ff7cd6a2)) (@df-wg)

### Features

* support AWS chain credentials for s3 storage providers ([#1250](https://github.com/wundergraph/cosmo/issues/1250)) ([5d67c4b](https://github.com/wundergraph/cosmo/commit/5d67c4b6aceb0a9fbf2bb99e57a75f5b163d93f9)) (@lachlan-smith)

## [0.124.1](https://github.com/wundergraph/cosmo/compare/router@0.124.0...router@0.124.1) (2024-10-11)

### Bug Fixes

* handling external fields ([#1266](https://github.com/wundergraph/cosmo/issues/1266)) ([fff7225](https://github.com/wundergraph/cosmo/commit/fff72258dbb453bcc94558b3440fe72d797e6d0a)) (@devsergiy)

# [0.124.0](https://github.com/wundergraph/cosmo/compare/router@0.123.0...router@0.124.0) (2024-10-11)

### Bug Fixes

* introspection query detection ([#1259](https://github.com/wundergraph/cosmo/issues/1259)) ([84af086](https://github.com/wundergraph/cosmo/commit/84af086baa4846faeebfd84c4629263e2c9454c1)) (@thisisnithin)

### Features

* add suppress fetch errors option to apollo compatibility flags ([#1258](https://github.com/wundergraph/cosmo/issues/1258)) ([a4d1adb](https://github.com/wundergraph/cosmo/commit/a4d1adba01e587b72cb5180eb3241f8943d34014)) (@JivusAyrus)

# [0.123.0](https://github.com/wundergraph/cosmo/compare/router@0.122.0...router@0.123.0) (2024-10-10)

### Bug Fixes

* return error when introspection query is made when disabled ([#1257](https://github.com/wundergraph/cosmo/issues/1257)) ([7d7a854](https://github.com/wundergraph/cosmo/commit/7d7a8545ab6dadf7826123793bd2ce4bc2a42eb5)) (@thisisnithin)

### Features

* create subsciption over multipart ([#1227](https://github.com/wundergraph/cosmo/issues/1227)) ([3bbc8d9](https://github.com/wundergraph/cosmo/commit/3bbc8d9c9e48cd3f37214214ca55954a1e97b00a)) (@df-wg)

# [0.122.0](https://github.com/wundergraph/cosmo/compare/router@0.121.1...router@0.122.0) (2024-10-09)

### Features

* add indirect interface fields to schema usage reporting ([#1235](https://github.com/wundergraph/cosmo/issues/1235)) ([1c62c14](https://github.com/wundergraph/cosmo/commit/1c62c14f9a9f11a6fbbebf5a3fbc4d85f304285e)) (@jensneuse)

## [0.121.1](https://github.com/wundergraph/cosmo/compare/router@0.121.0...router@0.121.1) (2024-10-07)

**Note:** Version bump only for package router

# [0.121.0](https://github.com/wundergraph/cosmo/compare/router@0.120.0...router@0.121.0) (2024-10-07)

### Features

* allow specified fields in subgraph errors ([#1248](https://github.com/wundergraph/cosmo/issues/1248)) ([72c770d](https://github.com/wundergraph/cosmo/commit/72c770d1d4d795f70586dfaa1a0ffab2943638a4)) (@thisisnithin)

# [0.120.0](https://github.com/wundergraph/cosmo/compare/router@0.119.1...router@0.120.0) (2024-10-07)

### Bug Fixes

* don't set empty cache control headers ([#1246](https://github.com/wundergraph/cosmo/issues/1246)) ([eb1ef06](https://github.com/wundergraph/cosmo/commit/eb1ef068a911eb36a813b9bc718f1a01db62785f)) (@df-wg)
* improve error logs ([#1247](https://github.com/wundergraph/cosmo/issues/1247)) ([19e5ba6](https://github.com/wundergraph/cosmo/commit/19e5ba62fd1dfe6167b66afc1123477ebdd83381)) (@StarpTech)

### Features

* fallback storage for execution config ([#1241](https://github.com/wundergraph/cosmo/issues/1241)) ([9704342](https://github.com/wundergraph/cosmo/commit/97043429bfadd69a86a560e2105dc8f641d6ad65)) (@thisisnithin)

## [0.119.1](https://github.com/wundergraph/cosmo/compare/router@0.119.0...router@0.119.1) (2024-10-03)

### Bug Fixes

* apollo compatibility for truncating floats, invalid __typenames ([#1242](https://github.com/wundergraph/cosmo/issues/1242)) ([a773ea5](https://github.com/wundergraph/cosmo/commit/a773ea53d7f9abe48033dad822f4424a31e28af2)) (@devsergiy)

# [0.119.0](https://github.com/wundergraph/cosmo/compare/router@0.118.0...router@0.119.0) (2024-10-03)

### Bug Fixes

* fix panic when accessController is nil in handleUpgradeRequest ([#1239](https://github.com/wundergraph/cosmo/issues/1239)) ([5699c03](https://github.com/wundergraph/cosmo/commit/5699c03db4d0b13b39643787700e49a389cf038d)) (@ElliottZeroFlucs)

### Features

* add option to add response header with trace id ([#1234](https://github.com/wundergraph/cosmo/issues/1234)) ([f8f5078](https://github.com/wundergraph/cosmo/commit/f8f50781917ee4bb0c24ac0c8aa9db71f87e9a05)) (@JivusAyrus)
* add option to have custom names client name and version headers ([#1233](https://github.com/wundergraph/cosmo/issues/1233)) ([e09348d](https://github.com/wundergraph/cosmo/commit/e09348d2925469e259b526c231a14c6abcc80916)) (@JivusAyrus)
* router version command ([#1240](https://github.com/wundergraph/cosmo/issues/1240)) ([39970e5](https://github.com/wundergraph/cosmo/commit/39970e5b1c6d8e2a2958f5ea55bb0d8aa7206d92)) (@StarpTech)

# [0.118.0](https://github.com/wundergraph/cosmo/compare/router@0.117.0...router@0.118.0) (2024-10-03)

### Features

* advanced access logs ([#1203](https://github.com/wundergraph/cosmo/issues/1203)) ([b4dc9ac](https://github.com/wundergraph/cosmo/commit/b4dc9acd964b2982fa9e27ec066e91583991ee17)) (@StarpTech)

# [0.117.0](https://github.com/wundergraph/cosmo/compare/router@0.116.3...router@0.117.0) (2024-10-02)

### Features

* add apollo compatibility flag to truncate floats ([#1236](https://github.com/wundergraph/cosmo/issues/1236)) ([17c80c9](https://github.com/wundergraph/cosmo/commit/17c80c91f4e594cf48dae887840517b588bbe0f8)) (@jensneuse)

## [0.116.3](https://github.com/wundergraph/cosmo/compare/router@0.116.2...router@0.116.3) (2024-09-30)

### Bug Fixes

* upgrade engine for ws deadlock, remove pont pool ([#1230](https://github.com/wundergraph/cosmo/issues/1230)) ([3ac50f8](https://github.com/wundergraph/cosmo/commit/3ac50f8b878fb6a5e2460c22aa94412a28c49600)) (@StarpTech)

## [0.116.2](https://github.com/wundergraph/cosmo/compare/router@0.116.1...router@0.116.2) (2024-09-30)

### Bug Fixes

* value completion reset, preserve __typename field location ([#1228](https://github.com/wundergraph/cosmo/issues/1228)) ([9d671f0](https://github.com/wundergraph/cosmo/commit/9d671f071af6d6b5789968682b98a9c5b7f9a7ec)) (@devsergiy)
* **websocket:** avoid data race on client request ([#1226](https://github.com/wundergraph/cosmo/issues/1226)) ([dd3ef36](https://github.com/wundergraph/cosmo/commit/dd3ef360447afae8c95149ac71f4f9e1c15f66dd)) (@StarpTech)

## [0.116.1](https://github.com/wundergraph/cosmo/compare/router@0.116.0...router@0.116.1) (2024-09-30)

### Bug Fixes

* planning of consecutive fragments and fragments on union ([#1223](https://github.com/wundergraph/cosmo/issues/1223)) ([3e390cd](https://github.com/wundergraph/cosmo/commit/3e390cd5cf6ca87694c6a25794aecd84d4f0c31e)) (@devsergiy)

# [0.116.0](https://github.com/wundergraph/cosmo/compare/router@0.115.1...router@0.116.0) (2024-09-27)

### Features

* move cache control policy to standalone config section ([#1218](https://github.com/wundergraph/cosmo/issues/1218)) ([7c3781f](https://github.com/wundergraph/cosmo/commit/7c3781f4f5073260d9a82dfb3fa7ab3d53cf4589)) (@df-wg)

## [0.115.1](https://github.com/wundergraph/cosmo/compare/router@0.115.0...router@0.115.1) (2024-09-25)

### Bug Fixes

* handle empty query in plan ([#1219](https://github.com/wundergraph/cosmo/issues/1219)) ([37af012](https://github.com/wundergraph/cosmo/commit/37af0123d8185897a5842616377be320b696037c)) (@thisisnithin)

# [0.115.0](https://github.com/wundergraph/cosmo/compare/router@0.114.1...router@0.115.0) (2024-09-24)

### Features

* enable datadog trace propagation ([#1204](https://github.com/wundergraph/cosmo/issues/1204)) ([1747bf5](https://github.com/wundergraph/cosmo/commit/1747bf53e5ccbd92e323cead8dfb2adccbfe3b7b)) (@df-wg)

## [0.114.1](https://github.com/wundergraph/cosmo/compare/router@0.114.0...router@0.114.1) (2024-09-23)

**Note:** Version bump only for package router

# [0.114.0](https://github.com/wundergraph/cosmo/compare/router@0.113.0...router@0.114.0) (2024-09-23)

### Features

* add apollo compatibility mode with support for valueCompletion ([#1205](https://github.com/wundergraph/cosmo/issues/1205)) ([18b1ef0](https://github.com/wundergraph/cosmo/commit/18b1ef01b12945d2f3acc80ea9548a17f9effa21)) (@jensneuse)

# [0.113.0](https://github.com/wundergraph/cosmo/compare/router@0.112.0...router@0.113.0) (2024-09-20)

### Bug Fixes

* remove printlns ([#1198](https://github.com/wundergraph/cosmo/issues/1198)) ([8b8fc88](https://github.com/wundergraph/cosmo/commit/8b8fc880eace135d957e5b572e6c5ba810ee51cf)) (@df-wg)

### Features

* implement set header ([#1196](https://github.com/wundergraph/cosmo/issues/1196)) ([c3cc9ec](https://github.com/wundergraph/cosmo/commit/c3cc9ec7dd17a8ee56422eb5d52361d4f781eb3f)) (@df-wg)

# [0.112.0](https://github.com/wundergraph/cosmo/compare/router@0.111.1...router@0.112.0) (2024-09-19)

### Features

* disable tracing through headers ([#1189](https://github.com/wundergraph/cosmo/issues/1189)) ([c23fd77](https://github.com/wundergraph/cosmo/commit/c23fd77871db68f7dc33b04ee1ac742476475817)) (@thisisnithin)
* return error from Router when Subgraph returns invalid value for __typename field ([#1194](https://github.com/wundergraph/cosmo/issues/1194)) ([b99d2fd](https://github.com/wundergraph/cosmo/commit/b99d2fdcd8b311028d11b501addb9d69e61c7df8)) (@jensneuse)

## [0.111.1](https://github.com/wundergraph/cosmo/compare/router@0.111.0...router@0.111.1) (2024-09-19)

### Bug Fixes

* **router:** ensure consistent request logs in error conditions ([#1192](https://github.com/wundergraph/cosmo/issues/1192)) ([e16ca1a](https://github.com/wundergraph/cosmo/commit/e16ca1a4034cd70bd99c72a9eeddd10b4c43d106)) (@StarpTech)

# [0.111.0](https://github.com/wundergraph/cosmo/compare/router@0.110.2...router@0.111.0) (2024-09-18)

### Bug Fixes

* propagate schema usage info for cached query plans as well ([#1186](https://github.com/wundergraph/cosmo/issues/1186)) ([dd00099](https://github.com/wundergraph/cosmo/commit/dd00099efb682f02ceb81f086980abc0851d4e21)) (@jensneuse)

### Features

* add response header propagation ([#1155](https://github.com/wundergraph/cosmo/issues/1155)) ([67f7545](https://github.com/wundergraph/cosmo/commit/67f7545b6073ea2abbda8f4f974f88deb38e668a)) (@jensneuse)
* allow playground consumers to customize headers ([#1183](https://github.com/wundergraph/cosmo/issues/1183)) ([80a7755](https://github.com/wundergraph/cosmo/commit/80a77550b0e8188602bf508e54224725c04e1ef8)) (@clayne11)

## [0.110.2](https://github.com/wundergraph/cosmo/compare/router@0.110.1...router@0.110.2) (2024-09-17)

### Bug Fixes

* ignore empty errors array ([#1181](https://github.com/wundergraph/cosmo/issues/1181)) ([bc5dda3](https://github.com/wundergraph/cosmo/commit/bc5dda393f727d8ee3483ea7e53c89377a0d2722)) (@devsergiy)
* persisting headers in playground and styling ([#1177](https://github.com/wundergraph/cosmo/issues/1177)) ([223a4d7](https://github.com/wundergraph/cosmo/commit/223a4d7f5a14406e0010df2e953c868466a9ace4)) (@thisisnithin)

## [0.110.1](https://github.com/wundergraph/cosmo/compare/router@0.110.0...router@0.110.1) (2024-09-13)

**Note:** Version bump only for package router

# [0.110.0](https://github.com/wundergraph/cosmo/compare/router@0.109.1...router@0.110.0) (2024-09-12)

### Features

* add max query depth ([#1153](https://github.com/wundergraph/cosmo/issues/1153)) ([5475a96](https://github.com/wundergraph/cosmo/commit/5475a961af7e772d9e9a5563cf8f20657ce68c30)) (@df-wg)
* make the maximum recycleable parser cache size configurable ([#1157](https://github.com/wundergraph/cosmo/issues/1157)) ([2b051bd](https://github.com/wundergraph/cosmo/commit/2b051bd3edbc2f8889fd6fd69b73d47798faab48)) (@jfroundjian)
* subgraph error propagation improvements ([#1164](https://github.com/wundergraph/cosmo/issues/1164)) ([2700061](https://github.com/wundergraph/cosmo/commit/27000616aa96de67a33e90fbddfcd851d815f2ab)) (@StarpTech)

## [0.109.1](https://github.com/wundergraph/cosmo/compare/router@0.109.0...router@0.109.1) (2024-09-09)

### Bug Fixes

* follow snake_case for all router logs ([#1114](https://github.com/wundergraph/cosmo/issues/1114)) ([e621548](https://github.com/wundergraph/cosmo/commit/e621548cf7d43a40f1b834aa1d37e942d06b1c04)) (@StarpTech)
* setting cached operation name ([#1158](https://github.com/wundergraph/cosmo/issues/1158)) ([3f15811](https://github.com/wundergraph/cosmo/commit/3f1581199148cbcabef165c7ddebaecc4f309ca7)) (@devsergiy)

# [0.109.0](https://github.com/wundergraph/cosmo/compare/router@0.108.0...router@0.109.0) (2024-09-05)

### Features

* query plan ui ([#1140](https://github.com/wundergraph/cosmo/issues/1140)) ([c255867](https://github.com/wundergraph/cosmo/commit/c25586728b34b177789a1d6a0fd9333e9e647959)) (@thisisnithin)

# [0.108.0](https://github.com/wundergraph/cosmo/compare/router@0.107.4...router@0.108.0) (2024-09-05)

### Features

* enable using HTTP(S)_PROXY in router  ([#1136](https://github.com/wundergraph/cosmo/issues/1136)) ([4600fdf](https://github.com/wundergraph/cosmo/commit/4600fdff6ab57541a6119e4e51180ed4403363a6)) (@AndreasZeissner)

## [0.107.4](https://github.com/wundergraph/cosmo/compare/router@0.107.3...router@0.107.4) (2024-08-30)

### Bug Fixes

* planning of provides, parent entity jump, conditional implicit keys, external fields ([#1092](https://github.com/wundergraph/cosmo/issues/1092)) ([0fe2cba](https://github.com/wundergraph/cosmo/commit/0fe2cbaa72fa7ba5dbbf97c1e95615f29f13af1f)) (@devsergiy)

## [0.107.3](https://github.com/wundergraph/cosmo/compare/router@0.107.2...router@0.107.3) (2024-08-30)

### Bug Fixes

* support __typename for introspection query ([#1131](https://github.com/wundergraph/cosmo/issues/1131)) ([704170e](https://github.com/wundergraph/cosmo/commit/704170e7417ce6352b5eaea63b65f3dc5b772dd8)) (@devsergiy)

## [0.107.2](https://github.com/wundergraph/cosmo/compare/router@0.107.1...router@0.107.2) (2024-08-28)

### Bug Fixes

* art render ([#1119](https://github.com/wundergraph/cosmo/issues/1119)) ([344d3db](https://github.com/wundergraph/cosmo/commit/344d3dbdff1758404903b9195708188a28be1898)) (@thisisnithin)
* show actual error from network in playground ([#1126](https://github.com/wundergraph/cosmo/issues/1126)) ([a83c6e3](https://github.com/wundergraph/cosmo/commit/a83c6e3404e1d69e3de3a6e0db20332933bcb1ab)) (@thisisnithin)

## [0.107.1](https://github.com/wundergraph/cosmo/compare/router@0.107.0...router@0.107.1) (2024-08-22)

### Bug Fixes

* unicode escaping by replacing fastjson version ([#1109](https://github.com/wundergraph/cosmo/issues/1109)) ([9d7812a](https://github.com/wundergraph/cosmo/commit/9d7812a03983eb6422e5e636e367814b1cc9b1fa)) (@devsergiy)

# [0.107.0](https://github.com/wundergraph/cosmo/compare/router@0.106.0...router@0.107.0) (2024-08-21)

### Features

* support GraphQL over GET ([#1103](https://github.com/wundergraph/cosmo/issues/1103)) ([e08c0fe](https://github.com/wundergraph/cosmo/commit/e08c0feb1a37a4b35befeabc3f734b44d82dc2ff)) (@StarpTech)

# [0.106.0](https://github.com/wundergraph/cosmo/compare/router@0.105.3...router@0.106.0) (2024-08-19)

### Features

* handle websocket authentication via initial payload ([#918](https://github.com/wundergraph/cosmo/issues/918)) ([e37e806](https://github.com/wundergraph/cosmo/commit/e37e80648a9f14d2f3df23c87922a3c99ee5204a)) (@alexandra-c)
* implement more efficient aggregation of schema usage metrics with caching ([#1095](https://github.com/wundergraph/cosmo/issues/1095)) ([a40c9d8](https://github.com/wundergraph/cosmo/commit/a40c9d83e8434bfe1a8338bd8892b110022c14ad)) (@jensneuse)

## [0.105.3](https://github.com/wundergraph/cosmo/compare/router@0.105.2...router@0.105.3) (2024-08-19)

### Bug Fixes

* semaphore is not released after panic ([#1069](https://github.com/wundergraph/cosmo/issues/1069)) ([fbd6bac](https://github.com/wundergraph/cosmo/commit/fbd6bac9522b663468acc2a95ea24fc32b142d47)) (@StarpTech)

## [0.105.2](https://github.com/wundergraph/cosmo/compare/router@0.105.1...router@0.105.2) (2024-08-16)

### Bug Fixes

* don't propagate client content negotiation headers with wildcard ([#1089](https://github.com/wundergraph/cosmo/issues/1089)) ([2e7d8d2](https://github.com/wundergraph/cosmo/commit/2e7d8d27d7fdaf0cc66cfb65ff3a8012fe083679)) (@StarpTech)
* dont initialize persisted operation client when disabled ([#1083](https://github.com/wundergraph/cosmo/issues/1083)) ([b483053](https://github.com/wundergraph/cosmo/commit/b483053d9be976895863aea1af90e01670731ba6)) (@flymedllva)

## [0.105.1](https://github.com/wundergraph/cosmo/compare/router@0.105.0...router@0.105.1) (2024-08-15)

### Bug Fixes

* polyfill crypto.randomUUID for localhost ([#1086](https://github.com/wundergraph/cosmo/issues/1086)) ([1a7776b](https://github.com/wundergraph/cosmo/commit/1a7776b1c1b2cfdf4095cf8046fe5f97bb641fe1)) (@StarpTech)

# [0.105.0](https://github.com/wundergraph/cosmo/compare/router@0.104.2...router@0.105.0) (2024-08-15)

### Features

* make file watcher more robust ([#1081](https://github.com/wundergraph/cosmo/issues/1081)) ([1b85ec5](https://github.com/wundergraph/cosmo/commit/1b85ec58eb67ffa3c56e65323fa9383ce7564e2e)) (@StarpTech)

## [0.104.2](https://github.com/wundergraph/cosmo/compare/router@0.104.1...router@0.104.2) (2024-08-14)

**Note:** Version bump only for package router

## [0.104.1](https://github.com/wundergraph/cosmo/compare/router@0.104.0...router@0.104.1) (2024-08-14)

**Note:** Version bump only for package router

# [0.104.0](https://github.com/wundergraph/cosmo/compare/router@0.103.0...router@0.104.0) (2024-08-14)

### Bug Fixes

* **cli-compose:** feature subgraph introspection ([#1078](https://github.com/wundergraph/cosmo/issues/1078)) ([13a7d63](https://github.com/wundergraph/cosmo/commit/13a7d638ac879e759e56d29fbd660aac5e3c3fc0)) (@StarpTech)

### Features

* expose query plans through response extensions field ([#1077](https://github.com/wundergraph/cosmo/issues/1077)) ([58430bc](https://github.com/wundergraph/cosmo/commit/58430bc7c90b2b21500a1471ef929950d0f0ce1a)) (@jensneuse)

# [0.103.0](https://github.com/wundergraph/cosmo/compare/router@0.102.1...router@0.103.0) (2024-08-09)

### Features

* add fetch tree resolver ([#1019](https://github.com/wundergraph/cosmo/issues/1019)) ([4f4dee7](https://github.com/wundergraph/cosmo/commit/4f4dee765ba73cabba7ff4fe95faa4e4935505ba)) (@jensneuse)

## [0.102.1](https://github.com/wundergraph/cosmo/compare/router@0.102.0...router@0.102.1) (2024-08-09)

**Note:** Version bump only for package router

# [0.102.0](https://github.com/wundergraph/cosmo/compare/router@0.101.2...router@0.102.0) (2024-08-06)

### Features

* add priority to modules ([#1002](https://github.com/wundergraph/cosmo/issues/1002)) ([4d7ac68](https://github.com/wundergraph/cosmo/commit/4d7ac68841e6f11da81b0d57da35c94923ac3833)) (@JivusAyrus)
* config file watcher ([#1013](https://github.com/wundergraph/cosmo/issues/1013)) ([d023d49](https://github.com/wundergraph/cosmo/commit/d023d4942a67dc80ac4e96be9249e8ea53c2ccaa)) (@StarpTech)
* new approach to pass execution config by file ([#1012](https://github.com/wundergraph/cosmo/issues/1012)) ([d357b79](https://github.com/wundergraph/cosmo/commit/d357b7997e4352ff49f72fe47a17340b126e4b63)) (@StarpTech)

## [0.101.2](https://github.com/wundergraph/cosmo/compare/router@0.101.1...router@0.101.2) (2024-08-04)

### Bug Fixes

* normalization overrides ([#1004](https://github.com/wundergraph/cosmo/issues/1004)) ([44737ae](https://github.com/wundergraph/cosmo/commit/44737ae5828a6255a51aacc0e359276433cb74d8)) (@jensneuse)

## [0.101.1](https://github.com/wundergraph/cosmo/compare/router@0.101.0...router@0.101.1) (2024-08-04)

**Note:** Version bump only for package router

# [0.101.0](https://github.com/wundergraph/cosmo/compare/router@0.100.1...router@0.101.0) (2024-08-02)

### Bug Fixes

* replace jsonparser with fastjson to delete exported variables ([#999](https://github.com/wundergraph/cosmo/issues/999)) ([0e3307e](https://github.com/wundergraph/cosmo/commit/0e3307e24c7e5185e35ab34f9f5c14903c4085d0)) (@jensneuse)

### Features

* allow disabling cors ([#998](https://github.com/wundergraph/cosmo/issues/998)) ([21304b1](https://github.com/wundergraph/cosmo/commit/21304b19cf44c1e20ff96792bdeaa70ff0b3263e)) (@thisisnithin)

## [0.100.1](https://github.com/wundergraph/cosmo/compare/router@0.100.0...router@0.100.1) (2024-08-01)

### Bug Fixes

* config poller is not required when static config is passed ([#995](https://github.com/wundergraph/cosmo/issues/995)) ([e5ba812](https://github.com/wundergraph/cosmo/commit/e5ba812eaec05dca91d4b0d8b066b7f2ff0651b3)) (@StarpTech)
* wrong otelhttp used ([#996](https://github.com/wundergraph/cosmo/issues/996)) ([6b322f6](https://github.com/wundergraph/cosmo/commit/6b322f62359da48336c7c9f4c07eac750db93907)) (@StarpTech)

# [0.100.0](https://github.com/wundergraph/cosmo/compare/router@0.99.3...router@0.100.0) (2024-08-01)

### Features

* implement s3 provider for config and persistent operations ([#971](https://github.com/wundergraph/cosmo/issues/971)) ([e3206ff](https://github.com/wundergraph/cosmo/commit/e3206fff9c1796a64173be350445514f26db9296)) (@StarpTech)
* set GOMEMLIMIT automatically ([#987](https://github.com/wundergraph/cosmo/issues/987)) ([11b5723](https://github.com/wundergraph/cosmo/commit/11b572317566395192263f8c7c81886a858f5e5e)) (@StarpTech)

## [0.99.3](https://github.com/wundergraph/cosmo/compare/router@0.99.2...router@0.99.3) (2024-08-01)

**Note:** Version bump only for package router

## [0.99.2](https://github.com/wundergraph/cosmo/compare/router@0.99.1...router@0.99.2) (2024-07-31)

### Bug Fixes

* excessive memory usage for big responses by disabling big pre-al… ([#986](https://github.com/wundergraph/cosmo/issues/986)) ([9aa5f29](https://github.com/wundergraph/cosmo/commit/9aa5f29cbaa12797753f280e49d32b6eed7c11b5)) (@jensneuse)
* routing url in router playground ([#985](https://github.com/wundergraph/cosmo/issues/985)) ([5029ddc](https://github.com/wundergraph/cosmo/commit/5029ddc34e5015b2d309c8f89f7511fc670c2696)) (@thisisnithin)

## [0.99.1](https://github.com/wundergraph/cosmo/compare/router@0.99.0...router@0.99.1) (2024-07-30)

### Bug Fixes

* input coercion for nested values ([#981](https://github.com/wundergraph/cosmo/issues/981)) ([5494e5f](https://github.com/wundergraph/cosmo/commit/5494e5f3075db7795c100c927001a4baae212c68)) (@jensneuse)

# [0.99.0](https://github.com/wundergraph/cosmo/compare/router@0.98.2...router@0.99.0) (2024-07-30)

### Bug Fixes

* client side validation for router playground ([#976](https://github.com/wundergraph/cosmo/issues/976)) ([9a276d8](https://github.com/wundergraph/cosmo/commit/9a276d8124cb8d102081c86fb39542158542200a)) (@JivusAyrus)

### Features

* package playground as library ([#975](https://github.com/wundergraph/cosmo/issues/975)) ([dc6ff32](https://github.com/wundergraph/cosmo/commit/dc6ff3274dc1db50283fa58d14051538df4af192)) (@thisisnithin)

## [0.98.2](https://github.com/wundergraph/cosmo/compare/router@0.98.1...router@0.98.2) (2024-07-27)

### Bug Fixes

* race for sendError, add test for sampling ([#967](https://github.com/wundergraph/cosmo/issues/967)) ([6d67207](https://github.com/wundergraph/cosmo/commit/6d67207ef55e888126a73eec40007b0ad2d65976)) (@StarpTech)
* remove slow brotli compression and use optimized gzip middleware ([#968](https://github.com/wundergraph/cosmo/issues/968)) ([1049be5](https://github.com/wundergraph/cosmo/commit/1049be552ccaf3ecee99b8970efd951a82c35054)) (@StarpTech)

## [0.98.1](https://github.com/wundergraph/cosmo/compare/router@0.98.0...router@0.98.1) (2024-07-24)

### Bug Fixes

* variable list coercion with normalization cache ([#956](https://github.com/wundergraph/cosmo/issues/956)) ([104ebe8](https://github.com/wundergraph/cosmo/commit/104ebe8f49b6975d10e897d767fb8d627e54145e)) (@jensneuse)

# [0.98.0](https://github.com/wundergraph/cosmo/compare/router@0.97.0...router@0.98.0) (2024-07-22)

### Bug Fixes

* optimize max concurrency for medium, high load, don't retry on 2xx status codes ([#950](https://github.com/wundergraph/cosmo/issues/950)) ([461946a](https://github.com/wundergraph/cosmo/commit/461946a1b6ef5a1a9b100ec806ba11580f15cadb)) (@StarpTech)

### Features

* expose normalization cache hit and acquire resolver wait time via otel ([#951](https://github.com/wundergraph/cosmo/issues/951)) ([e39437b](https://github.com/wundergraph/cosmo/commit/e39437b0164b99233bd182cda636cbc0392c556d)) (@StarpTech)

# [0.97.0](https://github.com/wundergraph/cosmo/compare/router@0.96.0...router@0.97.0) (2024-07-19)

### Features

* implement normalization cache for non-persisted operations ([#949](https://github.com/wundergraph/cosmo/issues/949)) ([63fbe7b](https://github.com/wundergraph/cosmo/commit/63fbe7bee310767a50ec53de94352462ef8308a0)) (@jensneuse)

# [0.96.0](https://github.com/wundergraph/cosmo/compare/router@0.95.7...router@0.96.0) (2024-07-18)

### Features

* improve JSON parsing & merging in the engine ([#937](https://github.com/wundergraph/cosmo/issues/937)) ([1717e16](https://github.com/wundergraph/cosmo/commit/1717e1659388f89cf3cc541c99b54bde5885fe17)) (@jensneuse)

## [0.95.7](https://github.com/wundergraph/cosmo/compare/router@0.95.6...router@0.95.7) (2024-07-16)

### Bug Fixes

* router config hot reload ([#923](https://github.com/wundergraph/cosmo/issues/923)) ([4bbf689](https://github.com/wundergraph/cosmo/commit/4bbf689a3a54441c82ab5f9205851a4a7441cef6)) (@StarpTech)

## [0.95.6](https://github.com/wundergraph/cosmo/compare/router@0.95.5...router@0.95.6) (2024-07-12)

### Bug Fixes

* playground crash on hard reload and better invalid headers error ([#934](https://github.com/wundergraph/cosmo/issues/934)) ([7306fb1](https://github.com/wundergraph/cosmo/commit/7306fb15f80a6371f59919cbb5890845d9ce6e74)) (@thisisnithin)

## [0.95.5](https://github.com/wundergraph/cosmo/compare/router@0.95.4...router@0.95.5) (2024-07-10)

### Bug Fixes

* playground explorer plugin crash ([#931](https://github.com/wundergraph/cosmo/issues/931)) ([ba10f16](https://github.com/wundergraph/cosmo/commit/ba10f165e2eb2ed6ee040ff981629ebb8b13ae16)) (@thisisnithin)

## [0.95.4](https://github.com/wundergraph/cosmo/compare/router@0.95.3...router@0.95.4) (2024-07-09)

### Bug Fixes

* close connection only after EOF and read error ([#919](https://github.com/wundergraph/cosmo/issues/919)) ([c2f87ef](https://github.com/wundergraph/cosmo/commit/c2f87ef228410fa39f8c1413401749fcd153222d)) (@StarpTech)
* upgrade deps due to found CVEs ([#926](https://github.com/wundergraph/cosmo/issues/926)) ([fc6e615](https://github.com/wundergraph/cosmo/commit/fc6e6158e2e761489033acb667cd0b36920c2612)) (@StarpTech)

## [0.95.3](https://github.com/wundergraph/cosmo/compare/router@0.95.2...router@0.95.3) (2024-07-05)

**Note:** Version bump only for package router

## [0.95.2](https://github.com/wundergraph/cosmo/compare/router@0.95.1...router@0.95.2) (2024-07-05)

**Note:** Version bump only for package router

## [0.95.1](https://github.com/wundergraph/cosmo/compare/router@0.95.0...router@0.95.1) (2024-07-04)

**Note:** Version bump only for package router

# [0.95.0](https://github.com/wundergraph/cosmo/compare/router@0.94.3...router@0.95.0) (2024-07-03)

### Features

* feature flags ([#853](https://github.com/wundergraph/cosmo/issues/853)) ([5461bb5](https://github.com/wundergraph/cosmo/commit/5461bb5a529decd51a1b22be0a5301936b8ad392)) (@JivusAyrus)

## [0.94.3](https://github.com/wundergraph/cosmo/compare/router@0.94.2...router@0.94.3) (2024-07-01)

### Bug Fixes

* merging deeply nested representation variables ([#902](https://github.com/wundergraph/cosmo/issues/902)) ([daa5b40](https://github.com/wundergraph/cosmo/commit/daa5b404ab9b7cf81553d089ebaeb26927c6c706)) (@devsergiy)

## [0.94.2](https://github.com/wundergraph/cosmo/compare/router@0.94.1...router@0.94.2) (2024-06-27)

### Bug Fixes

* support charset in content-type ([#899](https://github.com/wundergraph/cosmo/issues/899)) ([4da7d24](https://github.com/wundergraph/cosmo/commit/4da7d24d434a4d25e9eb3e71b9a373f70f11318d)) (@StarpTech)

## [0.94.1](https://github.com/wundergraph/cosmo/compare/router@0.94.0...router@0.94.1) (2024-06-26)

### Bug Fixes

* fix merging response nodes edge cases ([#897](https://github.com/wundergraph/cosmo/issues/897)) ([f5247db](https://github.com/wundergraph/cosmo/commit/f5247db8e80bd7d9224fd08c894a305bec035548)) (@devsergiy)

# [0.94.0](https://github.com/wundergraph/cosmo/compare/router@0.93.1...router@0.94.0) (2024-06-26)

### Features

* allow to disable file uploads ([#896](https://github.com/wundergraph/cosmo/issues/896)) ([bc94f15](https://github.com/wundergraph/cosmo/commit/bc94f1565cfc9aa8c6f4353d16d29c1cd4ec0fd3)) (@thisisnithin)
* support file upload in router ([#772](https://github.com/wundergraph/cosmo/issues/772)) ([d1cbc11](https://github.com/wundergraph/cosmo/commit/d1cbc11deedbdefad949a3aa5a1b753da4682145)) (@pedraumcosta)

## [0.93.1](https://github.com/wundergraph/cosmo/compare/router@0.93.0...router@0.93.1) (2024-06-25)

### Bug Fixes

* merging response nodes ([#888](https://github.com/wundergraph/cosmo/issues/888)) ([fb4b1a7](https://github.com/wundergraph/cosmo/commit/fb4b1a70eb1afec928551543f359d08eedae8863)) (@devsergiy)

# [0.93.0](https://github.com/wundergraph/cosmo/compare/router@0.92.5...router@0.93.0) (2024-06-25)

### Features

* add config option to enable subgraph minify ([#887](https://github.com/wundergraph/cosmo/issues/887)) ([a89c11a](https://github.com/wundergraph/cosmo/commit/a89c11ab283b24349d7e5d2502779c4ac71df877)) (@jensneuse)

## [0.92.5](https://github.com/wundergraph/cosmo/compare/router@0.92.4...router@0.92.5) (2024-06-24)

### Bug Fixes

* **engine-update:** processing websockets dials asynchronously ([#881](https://github.com/wundergraph/cosmo/issues/881)) ([130cb33](https://github.com/wundergraph/cosmo/commit/130cb3325a1ff78c180e604ebacc480525f36848)) (@StarpTech)

## [0.92.4](https://github.com/wundergraph/cosmo/compare/router@0.92.3...router@0.92.4) (2024-06-20)

### Bug Fixes

* requires planning, normalization of default values ([#867](https://github.com/wundergraph/cosmo/issues/867)) ([2ec6ef1](https://github.com/wundergraph/cosmo/commit/2ec6ef1b6be274203b59af338ff4f30ec97acb01)) (@devsergiy)

## [0.92.3](https://github.com/wundergraph/cosmo/compare/router@0.92.2...router@0.92.3) (2024-06-20)

### Bug Fixes

* client schema usage, update wgc router compose to use client schema ([#874](https://github.com/wundergraph/cosmo/issues/874)) ([c3cdb1b](https://github.com/wundergraph/cosmo/commit/c3cdb1bf1eda6907a7d2c4b3fe18de341e99fda0)) (@devsergiy)

## [0.92.2](https://github.com/wundergraph/cosmo/compare/router@0.92.1...router@0.92.2) (2024-06-07)

**Note:** Version bump only for package router

## [0.92.1](https://github.com/wundergraph/cosmo/compare/router@0.92.0...router@0.92.1) (2024-06-06)

**Note:** Version bump only for package router

# [0.92.0](https://github.com/wundergraph/cosmo/compare/router@0.91.0...router@0.92.0) (2024-06-06)

### Features

* allow to add custom OTEL attributes ([#856](https://github.com/wundergraph/cosmo/issues/856)) ([634fa85](https://github.com/wundergraph/cosmo/commit/634fa858f3ae437b1ebe46f39ed10195c0966885)) (@StarpTech)

# [0.91.0](https://github.com/wundergraph/cosmo/compare/router@0.90.3...router@0.91.0) (2024-05-31)

### Features

* support multiple/static NATS EDFS arg templates ([#841](https://github.com/wundergraph/cosmo/issues/841)) ([2c75870](https://github.com/wundergraph/cosmo/commit/2c75870cc65d5a43e864f69e39f202170257f9df)) (@Aenimus)

## [0.90.3](https://github.com/wundergraph/cosmo/compare/router@0.90.2...router@0.90.3) (2024-05-29)

**Note:** Version bump only for package router

## [0.90.2](https://github.com/wundergraph/cosmo/compare/router@0.90.1...router@0.90.2) (2024-05-28)

### Bug Fixes

* propagate resolvable false ([#835](https://github.com/wundergraph/cosmo/issues/835)) ([69003c1](https://github.com/wundergraph/cosmo/commit/69003c1a4c2f59317b8c4828bed893aa02973cb5)) (@Aenimus)

## [0.90.1](https://github.com/wundergraph/cosmo/compare/router@0.90.0...router@0.90.1) (2024-05-28)

### Bug Fixes

* merging response nodes, improve playground trace for skipped fetches ([#827](https://github.com/wundergraph/cosmo/issues/827)) ([70fc005](https://github.com/wundergraph/cosmo/commit/70fc005f3e2e7826d8f517de5f42119b96f95e79)) (@devsergiy)

# [0.90.0](https://github.com/wundergraph/cosmo/compare/router@0.89.2...router@0.90.0) (2024-05-27)

### Bug Fixes

* avoid reading large bodies when limit was hit ([#823](https://github.com/wundergraph/cosmo/issues/823)) ([a485aaf](https://github.com/wundergraph/cosmo/commit/a485aafd1a00d46904a3763a67a019fdf3b0f479)) (@StarpTech)

### Features

* add support for response compression ([#723](https://github.com/wundergraph/cosmo/issues/723)) ([a6c6ac4](https://github.com/wundergraph/cosmo/commit/a6c6ac415f79ad1e5a85e1bbd95337c13b47616f)) (@Rutik7066)
* allow to disable parent based sampling ([#825](https://github.com/wundergraph/cosmo/issues/825)) ([fdcc145](https://github.com/wundergraph/cosmo/commit/fdcc145b053f2aee520c64d534026839b73289e1)) (@StarpTech)

## [0.89.2](https://github.com/wundergraph/cosmo/compare/router@0.89.1...router@0.89.2) (2024-05-24)

### Bug Fixes

* set response properly as JSON data ([#817](https://github.com/wundergraph/cosmo/issues/817)) ([ce2177c](https://github.com/wundergraph/cosmo/commit/ce2177c2f6840dc9240cfda6959590bbfd9179c7)) (@StarpTech)

## [0.89.1](https://github.com/wundergraph/cosmo/compare/router@0.89.0...router@0.89.1) (2024-05-22)

### Bug Fixes

* level of null data propagation ([#812](https://github.com/wundergraph/cosmo/issues/812)) ([e6d92d6](https://github.com/wundergraph/cosmo/commit/e6d92d6adab101cf44756151961f15583f435ed8)) (@Aenimus)

# [0.89.0](https://github.com/wundergraph/cosmo/compare/router@0.88.0...router@0.89.0) (2024-05-21)

### Features

* improve operation parsing ([#810](https://github.com/wundergraph/cosmo/issues/810)) ([40da2d7](https://github.com/wundergraph/cosmo/commit/40da2d7c59c299228613d7bae4347089de13d061)) (@jensneuse)

# [0.88.0](https://github.com/wundergraph/cosmo/compare/router@0.87.0...router@0.88.0) (2024-05-21)

### Features

* implement subscription filter ([#780](https://github.com/wundergraph/cosmo/issues/780)) ([444a766](https://github.com/wundergraph/cosmo/commit/444a766b07de1998df52174a5a2e65086605e14c)) (@Aenimus)

# [0.87.0](https://github.com/wundergraph/cosmo/compare/router@0.86.3...router@0.87.0) (2024-05-21)

### Features

* add support for websocket subprotocol ([#776](https://github.com/wundergraph/cosmo/issues/776)) ([e35aa26](https://github.com/wundergraph/cosmo/commit/e35aa262227b29f09ddfdd1ce361c010b769b2da)) (@JivusAyrus)
* implement upgrade request allow list to forward headers and query params to the engine ([#748](https://github.com/wundergraph/cosmo/issues/748)) ([13a1624](https://github.com/wundergraph/cosmo/commit/13a1624c16d46a5adca21d82f48de181469621d8)) (@jensneuse)

## [0.86.3](https://github.com/wundergraph/cosmo/compare/router@0.86.2...router@0.86.3) (2024-05-20)

### Bug Fixes

* add tests and implement graphql over http cases ([#806](https://github.com/wundergraph/cosmo/issues/806)) ([6d73074](https://github.com/wundergraph/cosmo/commit/6d7307466f8918c138a6aee47dca6f4615fa3ed2)) (@jensneuse)
* playground theme settings ([#805](https://github.com/wundergraph/cosmo/issues/805)) ([00d692a](https://github.com/wundergraph/cosmo/commit/00d692aff8482e93cce7443e9665fec3031ef083)) (@thisisnithin)

## [0.86.2](https://github.com/wundergraph/cosmo/compare/router@0.86.1...router@0.86.2) (2024-05-17)

**Note:** Version bump only for package router

## [0.86.1](https://github.com/wundergraph/cosmo/compare/router@0.86.0...router@0.86.1) (2024-05-14)

### Bug Fixes

* enable remove unused variables normalization rule ([#790](https://github.com/wundergraph/cosmo/issues/790)) ([4cac7e4](https://github.com/wundergraph/cosmo/commit/4cac7e4dd581f2d091bc61ae50c83ccede5cf2f0)) (@devsergiy)

# [0.86.0](https://github.com/wundergraph/cosmo/compare/router@0.85.2...router@0.86.0) (2024-05-14)

### Bug Fixes

* usage of fragments on root query type, fix normalization issues ([#789](https://github.com/wundergraph/cosmo/issues/789)) ([e9239b4](https://github.com/wundergraph/cosmo/commit/e9239b40c938638eb11c94b858a436371474e7a5)) (@devsergiy)

### Features

* refactor edfs and add kafka support ([#770](https://github.com/wundergraph/cosmo/issues/770)) ([d659067](https://github.com/wundergraph/cosmo/commit/d659067fd1d094621788f42bac6d121b0831ebb7)) (@StarpTech)

## [0.85.2](https://github.com/wundergraph/cosmo/compare/router@0.85.1...router@0.85.2) (2024-05-10)

### Bug Fixes

* root level [@requires](https://github.com/requires) planning ([#779](https://github.com/wundergraph/cosmo/issues/779)) ([30113b3](https://github.com/wundergraph/cosmo/commit/30113b3d78d651c58e8c0ec5d7123f5bd7ff3ec5)) (@devsergiy)

## [0.85.1](https://github.com/wundergraph/cosmo/compare/router@0.85.0...router@0.85.1) (2024-05-06)

### Bug Fixes

* ignore unknown router execution config fields ([#767](https://github.com/wundergraph/cosmo/issues/767)) ([649a0e1](https://github.com/wundergraph/cosmo/commit/649a0e1349820642491469890f9eaa7b1134e430)) (@Aenimus)

# [0.85.0](https://github.com/wundergraph/cosmo/compare/router@0.84.5...router@0.85.0) (2024-05-03)

### Features

* support inaccessible and add foundation for contracts ([#764](https://github.com/wundergraph/cosmo/issues/764)) ([08a7db2](https://github.com/wundergraph/cosmo/commit/08a7db222ce1763ffe8062d3792c41e0c54b4224)) (@Aenimus)

## [0.84.5](https://github.com/wundergraph/cosmo/compare/router@0.84.4...router@0.84.5) (2024-05-02)

### Bug Fixes

* validate graphql operation in playground ([#763](https://github.com/wundergraph/cosmo/issues/763)) ([41bde5f](https://github.com/wundergraph/cosmo/commit/41bde5f06583242bbc9471e05179c1c16bb2f769)) (@thisisnithin)

## [0.84.4](https://github.com/wundergraph/cosmo/compare/router@0.84.3...router@0.84.4) (2024-04-30)

### Bug Fixes

* normalization of non-compatible nested fragment types ([#761](https://github.com/wundergraph/cosmo/issues/761)) ([3f42a17](https://github.com/wundergraph/cosmo/commit/3f42a171d2d7a32b24ba695aadfa8bfba85c8e39)) (@devsergiy)

## [0.84.3](https://github.com/wundergraph/cosmo/compare/router@0.84.2...router@0.84.3) (2024-04-30)

### Bug Fixes

* don't transmit persistedQuery extension to subgraphs ([#759](https://github.com/wundergraph/cosmo/issues/759)) ([07f0e4f](https://github.com/wundergraph/cosmo/commit/07f0e4fa309d859a5e5bc6511af2df03aedd3cdd)) (@StarpTech)

## [0.84.2](https://github.com/wundergraph/cosmo/compare/router@0.84.1...router@0.84.2) (2024-04-29)

### Bug Fixes

* field selection validation ([#758](https://github.com/wundergraph/cosmo/issues/758)) ([d29fbc6](https://github.com/wundergraph/cosmo/commit/d29fbc60df212eb6191a3fb4bbbd47d45de439cd)) (@devsergiy)

## [0.84.1](https://github.com/wundergraph/cosmo/compare/router@0.84.0...router@0.84.1) (2024-04-26)

### Bug Fixes

* set default ws subscription subprotocol ([#757](https://github.com/wundergraph/cosmo/issues/757)) ([94d1a5b](https://github.com/wundergraph/cosmo/commit/94d1a5bb29f41c56fd0e9753d8f6cd026b48497c)) (@devsergiy)

# [0.84.0](https://github.com/wundergraph/cosmo/compare/router@0.83.0...router@0.84.0) (2024-04-26)

### Features

* improve Subgraph error propagation ([#752](https://github.com/wundergraph/cosmo/issues/752)) ([0592378](https://github.com/wundergraph/cosmo/commit/0592378a86c23712f7d42ef5ee491bea4e3635ec)) (@jensneuse)
* log subgraph errors ([#753](https://github.com/wundergraph/cosmo/issues/753)) ([cf456d2](https://github.com/wundergraph/cosmo/commit/cf456d257879a541ff4ff1261fdc88a104b581ba)) (@StarpTech)

### Reverts

* Revert "chore(release): Publish [skip ci]" ([feaf2ef](https://github.com/wundergraph/cosmo/commit/feaf2ef49321388daff7c4d9f4558cdda78b5744)) (@)

# [0.83.0](https://github.com/wundergraph/cosmo/compare/router@0.82.3...router@0.83.0) (2024-04-23)

### Bug Fixes

* graphql error serialization ([#747](https://github.com/wundergraph/cosmo/issues/747)) ([119f179](https://github.com/wundergraph/cosmo/commit/119f179a0e169761bc207cff31976afca1832430)) (@jensneuse)
* ignore user agent for subscription deduplication ([#745](https://github.com/wundergraph/cosmo/issues/745)) ([3c1bfc0](https://github.com/wundergraph/cosmo/commit/3c1bfc0e6820deb0607e8847d118ab597e67d5b4)) (@StarpTech)

### Features

* allow to rename client headers on propagate to subgraphs ([#674](https://github.com/wundergraph/cosmo/issues/674)) ([b1dc228](https://github.com/wundergraph/cosmo/commit/b1dc2282b3e480a113925e688bffdc8aefd264a2)) (@Rutik7066)

## [0.82.3](https://github.com/wundergraph/cosmo/compare/router@0.82.2...router@0.82.3) (2024-04-18)

**Note:** Version bump only for package router

## [0.82.2](https://github.com/wundergraph/cosmo/compare/router@0.82.1...router@0.82.2) (2024-04-17)

### Bug Fixes

* retry on 500 origin errors ([#736](https://github.com/wundergraph/cosmo/issues/736)) ([202b331](https://github.com/wundergraph/cosmo/commit/202b3310ebcd96569055f1fc7431bb981ef78452)) (@StarpTech)
* subscriptions resolver race ([#739](https://github.com/wundergraph/cosmo/issues/739)) ([fa0f808](https://github.com/wundergraph/cosmo/commit/fa0f80842c7916e80a0af1c02034711b3948b92f)) (@jensneuse)
* **trace:** improve error tracking ([#734](https://github.com/wundergraph/cosmo/issues/734)) ([a5d7b5e](https://github.com/wundergraph/cosmo/commit/a5d7b5ecb8d892bb432480e1f0e268f27b1d1cf4)) (@StarpTech)

## [0.82.1](https://github.com/wundergraph/cosmo/compare/router@0.82.0...router@0.82.1) (2024-04-12)

**Note:** Version bump only for package router

# [0.82.0](https://github.com/wundergraph/cosmo/compare/router@0.81.0...router@0.82.0) (2024-04-11)

### Features

* support entity targets (implicit keys) ([#724](https://github.com/wundergraph/cosmo/issues/724)) ([4aa2c86](https://github.com/wundergraph/cosmo/commit/4aa2c86961384d913e964437b7ea369accb891c7)) (@Aenimus)

# [0.81.0](https://github.com/wundergraph/cosmo/compare/router@0.80.0...router@0.81.0) (2024-04-09)

### Features

* support Redis connection strings in router ([#697](https://github.com/wundergraph/cosmo/issues/697)) ([f7793c5](https://github.com/wundergraph/cosmo/commit/f7793c58ad7a8024d07c1a287bbe9a2b1c58846f)) (@akoenig)

# [0.80.0](https://github.com/wundergraph/cosmo/compare/router@0.79.2...router@0.80.0) (2024-04-09)

### Features

* support edfs subscription stream/consumer; multiple subjects ([#685](https://github.com/wundergraph/cosmo/issues/685)) ([c70b2ae](https://github.com/wundergraph/cosmo/commit/c70b2aefd39c45b5f98eae8a3c43f639d56064b2)) (@Aenimus)

## [0.79.2](https://github.com/wundergraph/cosmo/compare/router@0.79.1...router@0.79.2) (2024-04-06)

### Bug Fixes

* remove unused host-cpu metric ([#703](https://github.com/wundergraph/cosmo/issues/703)) ([a664631](https://github.com/wundergraph/cosmo/commit/a664631477d8b30b2448f8284db257f4d33446e6)) (@StarpTech)

## [0.79.1](https://github.com/wundergraph/cosmo/compare/router@0.79.0...router@0.79.1) (2024-04-04)

### Bug Fixes

* create individual metrics per error code ([#693](https://github.com/wundergraph/cosmo/issues/693)) ([d63d087](https://github.com/wundergraph/cosmo/commit/d63d087145d7ebeeba0673241e8f902c4008679b)) (@StarpTech)

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
