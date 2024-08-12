# Change Log
Binaries are attached to the github release otherwise all images can be found [here](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.102.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.102.0...controlplane@0.102.1) (2024-08-10)

**Note:** Version bump only for package controlplane

# [0.102.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.101.0...controlplane@0.102.0) (2024-08-09)

### Features

* add fetch tree resolver ([#1019](https://github.com/wundergraph/cosmo/issues/1019)) ([4f4dee7](https://github.com/wundergraph/cosmo/commit/4f4dee765ba73cabba7ff4fe95faa4e4935505ba)) (@jensneuse)

# [0.101.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.100.0...controlplane@0.101.0) (2024-08-09)

### Features

* global override for all operations in check ([#1044](https://github.com/wundergraph/cosmo/issues/1044)) ([6eb0e4d](https://github.com/wundergraph/cosmo/commit/6eb0e4dce9373260b12b4f7fd07f7637349bf2eb)) (@thisisnithin)
* webhook history view ([#1036](https://github.com/wundergraph/cosmo/issues/1036)) ([4457a57](https://github.com/wundergraph/cosmo/commit/4457a5735e86bd655bed685aca66287ed743e08c)) (@thisisnithin)

# [0.100.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.99.0...controlplane@0.100.0) (2024-08-09)

### Bug Fixes

* incorrect deletions count in slack notification ([#1037](https://github.com/wundergraph/cosmo/issues/1037)) ([93580de](https://github.com/wundergraph/cosmo/commit/93580deb0f711234b7000afc41742cc473dca66a)) (@thisisnithin)

### Features

* add command to create and publish feature subgraph in one command ([#960](https://github.com/wundergraph/cosmo/issues/960)) ([9a478e8](https://github.com/wundergraph/cosmo/commit/9a478e8164bfc7c933fedbe6188d7876e5c46c94)) (@JivusAyrus)

# [0.99.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.98.2...controlplane@0.99.0) (2024-08-06)

### Features

* **controlplane:** add overriding the mailing options ([#1008](https://github.com/wundergraph/cosmo/issues/1008)) ([f19ec90](https://github.com/wundergraph/cosmo/commit/f19ec90ca2cb2259384c2119291c43d4b5bcd11e)) (@AndreasZeissner)

## [0.98.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.98.1...controlplane@0.98.2) (2024-08-05)

### Bug Fixes

* avoid infinite recursion in openapi call ([#1011](https://github.com/wundergraph/cosmo/issues/1011)) ([9522f56](https://github.com/wundergraph/cosmo/commit/9522f564930b2170305196f9855ae7dc3cf2889d)) (@StarpTech)

## [0.98.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.98.0...controlplane@0.98.1) (2024-08-04)

### Bug Fixes

* **controlplane:** don't enable prom by default ([#1007](https://github.com/wundergraph/cosmo/issues/1007)) ([f26192d](https://github.com/wundergraph/cosmo/commit/f26192de9d516c5ed86be2b6876693ed381fceed)) (@StarpTech)

# [0.98.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.97.2...controlplane@0.98.0) (2024-08-01)

### Bug Fixes

* don't aggregate router sum metrics table, optimize router metrics queries ([#970](https://github.com/wundergraph/cosmo/issues/970)) ([7908a0f](https://github.com/wundergraph/cosmo/commit/7908a0f3e5a942d74f820dc64ad2079e1a420e18)) (@StarpTech)

### Features

* implement s3 provider for config and persistent operations ([#971](https://github.com/wundergraph/cosmo/issues/971)) ([e3206ff](https://github.com/wundergraph/cosmo/commit/e3206fff9c1796a64173be350445514f26db9296)) (@StarpTech)

## [0.97.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.97.1...controlplane@0.97.2) (2024-07-31)

**Note:** Version bump only for package controlplane

## [0.97.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.97.0...controlplane@0.97.1) (2024-07-26)

### Bug Fixes

* org activation jobs and delete user script ([#966](https://github.com/wundergraph/cosmo/issues/966)) ([a81b4a5](https://github.com/wundergraph/cosmo/commit/a81b4a57ab5702703fd6218d90c200c5a8a543f5)) (@thisisnithin)

# [0.97.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.96.1...controlplane@0.97.0) (2024-07-25)

### Features

* k8 jobs for user deletion and org activation ([#958](https://github.com/wundergraph/cosmo/issues/958)) ([c216414](https://github.com/wundergraph/cosmo/commit/c216414fac9e582548073e87cfeb1c795315122a)) (@thisisnithin)

## [0.96.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.96.0...controlplane@0.96.1) (2024-07-24)

### Bug Fixes

* variable list coercion with normalization cache ([#956](https://github.com/wundergraph/cosmo/issues/956)) ([104ebe8](https://github.com/wundergraph/cosmo/commit/104ebe8f49b6975d10e897d767fb8d627e54145e)) (@jensneuse)

# [0.96.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.95.0...controlplane@0.96.0) (2024-07-23)

### Features

* instrument controlplane with metrics ([#943](https://github.com/wundergraph/cosmo/issues/943)) ([0e74d6c](https://github.com/wundergraph/cosmo/commit/0e74d6c9c7699a335bb56d74bfc0cf3b2fdbc70e)) (@AndreasZeissner)

# [0.95.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.94.0...controlplane@0.95.0) (2024-07-23)

### Bug Fixes

* log commit check failure as warning instead of error ([#954](https://github.com/wundergraph/cosmo/issues/954)) ([47a1e84](https://github.com/wundergraph/cosmo/commit/47a1e840d0d4cb50d3667e3a35dd29f70e8ab813)) (@thisisnithin)

### Features

* organization deactivation ([#945](https://github.com/wundergraph/cosmo/issues/945)) ([af5cd41](https://github.com/wundergraph/cosmo/commit/af5cd41848c282027c6a07545bdb218edc946da5)) (@thisisnithin)

# [0.94.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.93.6...controlplane@0.94.0) (2024-07-22)

### Features

* expose normalization cache hit and acquire resolver wait time via otel ([#951](https://github.com/wundergraph/cosmo/issues/951)) ([e39437b](https://github.com/wundergraph/cosmo/commit/e39437b0164b99233bd182cda636cbc0392c556d)) (@StarpTech)

## [0.93.6](https://github.com/wundergraph/cosmo/compare/controlplane@0.93.5...controlplane@0.93.6) (2024-07-19)

### Bug Fixes

* incorrect typecast on timestamp from db ([#948](https://github.com/wundergraph/cosmo/issues/948)) ([471fa45](https://github.com/wundergraph/cosmo/commit/471fa456ab9f3f2a567162f3ea60fe8f5cc31bbb)) (@thisisnithin)

## [0.93.5](https://github.com/wundergraph/cosmo/compare/controlplane@0.93.4...controlplane@0.93.5) (2024-07-18)

### Bug Fixes

* **controlplane:** graceful hutdown ([#946](https://github.com/wundergraph/cosmo/issues/946)) ([4da7df1](https://github.com/wundergraph/cosmo/commit/4da7df12e19a6c1efde479f1b211e19b659afbfd)) (@StarpTech)

## [0.93.4](https://github.com/wundergraph/cosmo/compare/controlplane@0.93.3...controlplane@0.93.4) (2024-07-16)

**Note:** Version bump only for package controlplane

## [0.93.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.93.2...controlplane@0.93.3) (2024-07-12)

### Bug Fixes

* scim server when adding existing user ([#935](https://github.com/wundergraph/cosmo/issues/935)) ([0265f2a](https://github.com/wundergraph/cosmo/commit/0265f2a99dd45d457b7056048d27abce49fbc08b)) (@JivusAyrus)

## [0.93.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.93.1...controlplane@0.93.2) (2024-07-12)

### Bug Fixes

* getConfig script imports ([#936](https://github.com/wundergraph/cosmo/issues/936)) ([2781c12](https://github.com/wundergraph/cosmo/commit/2781c1226a2d5ea989415c0ff241dc2f6584d49e)) (@thisisnithin)

## [0.93.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.93.0...controlplane@0.93.1) (2024-07-11)

### Bug Fixes

* remove REQUIRE_DEPRECATION_DATE lint rule ([#890](https://github.com/wundergraph/cosmo/issues/890)) ([1203d7f](https://github.com/wundergraph/cosmo/commit/1203d7f711c35f1bdd8a7ce6bec38dcd1093fff4)) (@JivusAyrus)

# [0.93.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.92.2...controlplane@0.93.0) (2024-07-10)

### Features

* delete user ([#906](https://github.com/wundergraph/cosmo/issues/906)) ([5d438a1](https://github.com/wundergraph/cosmo/commit/5d438a1a2e1be610ff0e139efd692ed798daf677)) (@thisisnithin)

## [0.92.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.92.1...controlplane@0.92.2) (2024-07-09)

### Bug Fixes

* admission webhook controller not receiving secret ([#928](https://github.com/wundergraph/cosmo/issues/928)) ([9adb17e](https://github.com/wundergraph/cosmo/commit/9adb17ea24419c34dc0fe898d9f03bc2329fddf0)) (@thisisnithin)
* upgrade deps due to found CVEs ([#926](https://github.com/wundergraph/cosmo/issues/926)) ([fc6e615](https://github.com/wundergraph/cosmo/commit/fc6e6158e2e761489033acb667cd0b36920c2612)) (@StarpTech)

## [0.92.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.92.0...controlplane@0.92.1) (2024-07-03)

### Bug Fixes

* limit check and remove router_config_path ([#911](https://github.com/wundergraph/cosmo/issues/911)) ([93180ed](https://github.com/wundergraph/cosmo/commit/93180edbe3f2f84e1c95f3d3a9acd57ec337a6dc)) (@JivusAyrus)

# [0.92.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.91.5...controlplane@0.92.0) (2024-07-03)

### Features

* feature flags ([#853](https://github.com/wundergraph/cosmo/issues/853)) ([5461bb5](https://github.com/wundergraph/cosmo/commit/5461bb5a529decd51a1b22be0a5301936b8ad392)) (@JivusAyrus)

## [0.91.5](https://github.com/wundergraph/cosmo/compare/controlplane@0.91.4...controlplane@0.91.5) (2024-07-02)

### Bug Fixes

* race while fetching configuration for graph notifications ([#903](https://github.com/wundergraph/cosmo/issues/903)) ([c79bb2c](https://github.com/wundergraph/cosmo/commit/c79bb2c894a8c2345e40b1a40779b28fcfa16103)) (@thisisnithin)

## [0.91.4](https://github.com/wundergraph/cosmo/compare/controlplane@0.91.3...controlplane@0.91.4) (2024-07-01)

**Note:** Version bump only for package controlplane

## [0.91.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.91.2...controlplane@0.91.3) (2024-06-25)

### Bug Fixes

* cleanup inspectable check ([#884](https://github.com/wundergraph/cosmo/issues/884)) ([5bcf149](https://github.com/wundergraph/cosmo/commit/5bcf14915115d400ea6dc394b5d219e4f6e2eaca)) (@thisisnithin)

## [0.91.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.91.1...controlplane@0.91.2) (2024-06-24)

### Bug Fixes

* empty admission webhook secret ([#882](https://github.com/wundergraph/cosmo/issues/882)) ([cca7430](https://github.com/wundergraph/cosmo/commit/cca7430aca2f7464e308ae94cb211ce74d75a705)) (@thisisnithin)
* ignore directive changes instead of throwing ([#859](https://github.com/wundergraph/cosmo/issues/859)) ([0f6d7dc](https://github.com/wundergraph/cosmo/commit/0f6d7dc0e8bbdd486d9c766a5b14d6611cf9deeb)) (@thisisnithin)
* link composition from changelog ([#857](https://github.com/wundergraph/cosmo/issues/857)) ([45ebcfc](https://github.com/wundergraph/cosmo/commit/45ebcfcb30d7f0aa083ba0dc7798bf6678847091)) (@thisisnithin)
* remove console log ([#883](https://github.com/wundergraph/cosmo/issues/883)) ([d9b23e3](https://github.com/wundergraph/cosmo/commit/d9b23e384a37d0fb399de6404980df3e2074907e)) (@thisisnithin)

## [0.91.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.91.0...controlplane@0.91.1) (2024-06-20)

**Note:** Version bump only for package controlplane

# [0.91.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.90.1...controlplane@0.91.0) (2024-06-20)

### Features

* add subscripion protocol and ws subprotocol to ui ([#829](https://github.com/wundergraph/cosmo/issues/829)) ([26708e4](https://github.com/wundergraph/cosmo/commit/26708e4d02fa3a6fa44b39a8c9138bd14a78c96f)) (@JivusAyrus)

## [0.90.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.90.0...controlplane@0.90.1) (2024-06-07)

**Note:** Version bump only for package controlplane

# [0.90.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.89.0...controlplane@0.90.0) (2024-06-06)

### Features

* handle creating, publishing, and updating Event-Driven Graphs ([#855](https://github.com/wundergraph/cosmo/issues/855)) ([fc2a8f2](https://github.com/wundergraph/cosmo/commit/fc2a8f20b97a17d0927c589f81df66ff7abf78c5)) (@Aenimus)

# [0.89.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.88.10...controlplane@0.89.0) (2024-06-05)

### Features

* admission webhook signature ([#852](https://github.com/wundergraph/cosmo/issues/852)) ([9212bb3](https://github.com/wundergraph/cosmo/commit/9212bb3aa3f3ca41f38c7944c3e6022c5fdc3ca8)) (@thisisnithin)

## [0.88.10](https://github.com/wundergraph/cosmo/compare/controlplane@0.88.9...controlplane@0.88.10) (2024-06-04)

### Bug Fixes

* missing namespace in github check details link ([#847](https://github.com/wundergraph/cosmo/issues/847)) ([7f413c6](https://github.com/wundergraph/cosmo/commit/7f413c62633cfd082b15e724bb5c9b8118951e99)) (@thisisnithin)

## [0.88.9](https://github.com/wundergraph/cosmo/compare/controlplane@0.88.8...controlplane@0.88.9) (2024-05-31)

### Bug Fixes

* clickhouse cardinality mismatch ([#669](https://github.com/wundergraph/cosmo/issues/669)) ([1908089](https://github.com/wundergraph/cosmo/commit/1908089a6cd62d8e60625555f1173102ce5d8f57)) (@thisisnithin)

## [0.88.8](https://github.com/wundergraph/cosmo/compare/controlplane@0.88.7...controlplane@0.88.8) (2024-05-30)

**Note:** Version bump only for package controlplane

## [0.88.7](https://github.com/wundergraph/cosmo/compare/controlplane@0.88.6...controlplane@0.88.7) (2024-05-29)

### Bug Fixes

* query source table instead of MV to avoid type mismatch ([#837](https://github.com/wundergraph/cosmo/issues/837)) ([a552226](https://github.com/wundergraph/cosmo/commit/a5522269fdebdb8e1e384193075666cb3a8bcc49)) (@StarpTech)

## [0.88.6](https://github.com/wundergraph/cosmo/compare/controlplane@0.88.5...controlplane@0.88.6) (2024-05-29)

### Bug Fixes

* prevent subgraph update except schema in publish ([#831](https://github.com/wundergraph/cosmo/issues/831)) ([37a9701](https://github.com/wundergraph/cosmo/commit/37a9701a2b9c61a9ecd489584cd6e2a9fe7ab70b)) (@thisisnithin)

## [0.88.5](https://github.com/wundergraph/cosmo/compare/controlplane@0.88.4...controlplane@0.88.5) (2024-05-28)

### Bug Fixes

* members invite count and ui spacing ([#833](https://github.com/wundergraph/cosmo/issues/833)) ([487b4e1](https://github.com/wundergraph/cosmo/commit/487b4e18333a0315dca99f1a20884c8bedeff88d)) (@thisisnithin)

## [0.88.4](https://github.com/wundergraph/cosmo/compare/controlplane@0.88.3...controlplane@0.88.4) (2024-05-24)

### Bug Fixes

* remove unused attributes ([#819](https://github.com/wundergraph/cosmo/issues/819)) ([1066d9f](https://github.com/wundergraph/cosmo/commit/1066d9fc97f460357434b633ce6be8baa78ae929)) (@JivusAyrus)
* unset admission webhook using empty string ([#820](https://github.com/wundergraph/cosmo/issues/820)) ([eaf470e](https://github.com/wundergraph/cosmo/commit/eaf470e6b31f828b8b316751337b739c4c158e5d)) (@thisisnithin)

## [0.88.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.88.2...controlplane@0.88.3) (2024-05-22)

### Bug Fixes

* playground config, subgraphs and members table, graph visualization ([#809](https://github.com/wundergraph/cosmo/issues/809)) ([bbdb8cd](https://github.com/wundergraph/cosmo/commit/bbdb8cd858a008051cd1ebb76d5d5f21a33f541a)) (@thisisnithin)

## [0.88.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.88.1...controlplane@0.88.2) (2024-05-21)

### Bug Fixes

* set expiry for the jwt ([#811](https://github.com/wundergraph/cosmo/issues/811)) ([05623c5](https://github.com/wundergraph/cosmo/commit/05623c59607a7bcab377e184f96c45374c3b7e27)) (@JivusAyrus)

## [0.88.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.88.0...controlplane@0.88.1) (2024-05-21)

**Note:** Version bump only for package controlplane

# [0.88.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.87.0...controlplane@0.88.0) (2024-05-21)

### Features

* add support for websocket subprotocol ([#776](https://github.com/wundergraph/cosmo/issues/776)) ([e35aa26](https://github.com/wundergraph/cosmo/commit/e35aa262227b29f09ddfdd1ce361c010b769b2da)) (@JivusAyrus)

# [0.87.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.86.0...controlplane@0.87.0) (2024-05-17)

### Bug Fixes

* parser errors during linting ([#797](https://github.com/wundergraph/cosmo/issues/797)) ([9a88265](https://github.com/wundergraph/cosmo/commit/9a8826509264ad2f4e8255c7449ca3355d3ffb50)) (@JivusAyrus)

### Features

* schema contracts ([#751](https://github.com/wundergraph/cosmo/issues/751)) ([1bc1a78](https://github.com/wundergraph/cosmo/commit/1bc1a787f046d25f0a4affb3fe42efe39a1c6539)) (@thisisnithin)

# [0.86.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.85.2...controlplane@0.86.0) (2024-05-14)

### Features

* refactor edfs and add kafka support ([#770](https://github.com/wundergraph/cosmo/issues/770)) ([d659067](https://github.com/wundergraph/cosmo/commit/d659067fd1d094621788f42bac6d121b0831ebb7)) (@StarpTech)

## [0.85.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.85.1...controlplane@0.85.2) (2024-05-10)

### Bug Fixes

* write access for operation overrides ([#777](https://github.com/wundergraph/cosmo/issues/777)) ([4f973c1](https://github.com/wundergraph/cosmo/commit/4f973c1d564798bc63a98281a898cff85c0a92eb)) (@thisisnithin)

## [0.85.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.85.0...controlplane@0.85.1) (2024-05-06)

### Bug Fixes

* ignore unknown router execution config fields ([#767](https://github.com/wundergraph/cosmo/issues/767)) ([649a0e1](https://github.com/wundergraph/cosmo/commit/649a0e1349820642491469890f9eaa7b1134e430)) (@Aenimus)

# [0.85.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.84.2...controlplane@0.85.0) (2024-05-03)

### Features

* support inaccessible and add foundation for contracts ([#764](https://github.com/wundergraph/cosmo/issues/764)) ([08a7db2](https://github.com/wundergraph/cosmo/commit/08a7db222ce1763ffe8062d3792c41e0c54b4224)) (@Aenimus)

## [0.84.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.84.1...controlplane@0.84.2) (2024-05-01)

### Bug Fixes

* verify the user from keycloak and sanitize emails ([#762](https://github.com/wundergraph/cosmo/issues/762)) ([4f5d4a0](https://github.com/wundergraph/cosmo/commit/4f5d4a057c53177e9b6c6cff69762fc6c0859ab8)) (@JivusAyrus)

## [0.84.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.84.0...controlplane@0.84.1) (2024-04-30)

### Bug Fixes

* scim server issues ([#754](https://github.com/wundergraph/cosmo/issues/754)) ([3fdf328](https://github.com/wundergraph/cosmo/commit/3fdf32816fde4ffdb3c16e6eb8b2fc9d63ee7e92)) (@JivusAyrus)

# [0.84.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.83.0...controlplane@0.84.0) (2024-04-26)

### Features

* add apollo compatibility mode in wgc federated-graph fetch command ([#742](https://github.com/wundergraph/cosmo/issues/742)) ([ecd73ab](https://github.com/wundergraph/cosmo/commit/ecd73ab91e1c8289008cae1062220826884d26e8)) (@JivusAyrus)

# [0.83.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.82.8...controlplane@0.83.0) (2024-04-26)

### Features

* log subgraph errors ([#753](https://github.com/wundergraph/cosmo/issues/753)) ([cf456d2](https://github.com/wundergraph/cosmo/commit/cf456d257879a541ff4ff1261fdc88a104b581ba)) (@StarpTech)

## [0.82.8](https://github.com/wundergraph/cosmo/compare/controlplane@0.82.7...controlplane@0.82.8) (2024-04-23)

### Bug Fixes

* upgrade deps to cover CVEs ([#750](https://github.com/wundergraph/cosmo/issues/750)) ([e261beb](https://github.com/wundergraph/cosmo/commit/e261beb8375ca41eb8a2fa4b3223d202c3bb7460)) (@StarpTech)

## [0.82.7](https://github.com/wundergraph/cosmo/compare/controlplane@0.82.6...controlplane@0.82.7) (2024-04-23)

### Reverts

* Revert "chore(release): Publish [skip ci]" ([feaf2ef](https://github.com/wundergraph/cosmo/commit/feaf2ef49321388daff7c4d9f4558cdda78b5744)) (@StarpTech)

## [0.82.6](https://github.com/wundergraph/cosmo/compare/controlplane@0.82.5...controlplane@0.82.6) (2024-04-17)

### Bug Fixes

* make sure an api key with no resources can not be created ([#728](https://github.com/wundergraph/cosmo/issues/728)) ([7717ff6](https://github.com/wundergraph/cosmo/commit/7717ff6a147c485683a3d26c9e8f3b98173e67ee)) (@JivusAyrus)

## [0.82.5](https://github.com/wundergraph/cosmo/compare/controlplane@0.82.4...controlplane@0.82.5) (2024-04-12)

### Bug Fixes

* analytics group filter omission ([#729](https://github.com/wundergraph/cosmo/issues/729)) ([ba316af](https://github.com/wundergraph/cosmo/commit/ba316affc5cd413d93731d04ad3e58e214827f9b)) (@thisisnithin)
* inform users if there is nothing new to publish ([#710](https://github.com/wundergraph/cosmo/issues/710)) ([faf01fc](https://github.com/wundergraph/cosmo/commit/faf01fc9e398ef70873abeec8eee06e797cbabf3)) (@JivusAyrus)
* let everybody create orgs ([#709](https://github.com/wundergraph/cosmo/issues/709)) ([13ac13c](https://github.com/wundergraph/cosmo/commit/13ac13c64859204c46744a1d54638773dff6e30a)) (@JivusAyrus)

## [0.82.4](https://github.com/wundergraph/cosmo/compare/controlplane@0.82.3...controlplane@0.82.4) (2024-04-11)

**Note:** Version bump only for package controlplane

## [0.82.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.82.2...controlplane@0.82.3) (2024-04-10)

### Bug Fixes

* validate whether webhook exists ([#718](https://github.com/wundergraph/cosmo/issues/718)) ([81065d2](https://github.com/wundergraph/cosmo/commit/81065d20e4c47b66bf47edc3b590c9d6e217e046)) (@StarpTech)

## [0.82.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.82.1...controlplane@0.82.2) (2024-04-09)

### Bug Fixes

* authenticate organization id before updating webhooks ([#713](https://github.com/wundergraph/cosmo/issues/713)) ([64e78e2](https://github.com/wundergraph/cosmo/commit/64e78e29ec750c993faa661b241cb1f0edb4bbb3)) (@StarpTech)

## [0.82.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.82.0...controlplane@0.82.1) (2024-04-09)

**Note:** Version bump only for package controlplane

# [0.82.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.81.2...controlplane@0.82.0) (2024-04-08)

### Features

* support TLS in organization seed ([#707](https://github.com/wundergraph/cosmo/issues/707)) ([2596c7a](https://github.com/wundergraph/cosmo/commit/2596c7a2e249465f777f120136afb66c1f0903ab)) (@StarpTech)

## [0.81.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.81.1...controlplane@0.81.2) (2024-04-04)

### Bug Fixes

* create database clickhouse, arm incompatibilities ([c88dd50](https://github.com/wundergraph/cosmo/commit/c88dd507318334d40e9352a69a5df32d047d94f4)) (@StarpTech)

## [0.81.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.81.0...controlplane@0.81.1) (2024-04-03)

**Note:** Version bump only for package controlplane

# [0.81.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.80.3...controlplane@0.81.0) (2024-04-03)

### Features

* implement scim server ([#664](https://github.com/wundergraph/cosmo/issues/664)) ([12591da](https://github.com/wundergraph/cosmo/commit/12591da32ef62e9498855ceda37beba72835a801)) (@JivusAyrus)

## [0.80.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.80.2...controlplane@0.80.3) (2024-04-03)

### Bug Fixes

* use printSchemaWithDirectives instead of printSchema ([#676](https://github.com/wundergraph/cosmo/issues/676)) ([2884103](https://github.com/wundergraph/cosmo/commit/288410317150bdd6b14db1f46a8d10448a7c9c07)) (@JivusAyrus)

## [0.80.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.80.1...controlplane@0.80.2) (2024-03-28)

### Bug Fixes

* improve error handling in the migrator ([#673](https://github.com/wundergraph/cosmo/issues/673)) ([8270368](https://github.com/wundergraph/cosmo/commit/82703687066d5ca9af5b4f0eca33007d513cfdb4)) (@JivusAyrus)

## [0.80.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.80.0...controlplane@0.80.1) (2024-03-26)

### Bug Fixes

* conflicting subgraph name on monograph creation ([#668](https://github.com/wundergraph/cosmo/issues/668)) ([1b57233](https://github.com/wundergraph/cosmo/commit/1b57233f6f91b4219e60d975a8f7727129bd9ea6)) (@thisisnithin)
* webhook and slack retrieving incorrect graph list ([#671](https://github.com/wundergraph/cosmo/issues/671)) ([0cb4f36](https://github.com/wundergraph/cosmo/commit/0cb4f3644430a73a9d18a2792a025e81260ff8be)) (@thisisnithin)

# [0.80.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.79.4...controlplane@0.80.0) (2024-03-24)

### Features

* multi platform docker builds ([#665](https://github.com/wundergraph/cosmo/issues/665)) ([4c24d70](https://github.com/wundergraph/cosmo/commit/4c24d7075bd48cd946a1037bffc0c4fcaef74289)) (@StarpTech)

## [0.79.4](https://github.com/wundergraph/cosmo/compare/controlplane@0.79.3...controlplane@0.79.4) (2024-03-21)

### Bug Fixes

* show all subgraphs in organization subgraph list ([#659](https://github.com/wundergraph/cosmo/issues/659)) ([1ebc767](https://github.com/wundergraph/cosmo/commit/1ebc767c9f7f6a632fc107c686be63d470993ee1)) (@StarpTech)

## [0.79.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.79.2...controlplane@0.79.3) (2024-03-21)

**Note:** Version bump only for package controlplane

## [0.79.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.79.1...controlplane@0.79.2) (2024-03-21)

### Bug Fixes

* github check api crashes schema check ([#658](https://github.com/wundergraph/cosmo/issues/658)) ([db2e1e4](https://github.com/wundergraph/cosmo/commit/db2e1e4366028f71fceec4e47284411d404a9427)) (@thisisnithin)

## [0.79.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.79.0...controlplane@0.79.1) (2024-03-20)

**Note:** Version bump only for package controlplane

# [0.79.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.78.0...controlplane@0.79.0) (2024-03-20)

### Features

* monograph support ([#623](https://github.com/wundergraph/cosmo/issues/623)) ([a255f74](https://github.com/wundergraph/cosmo/commit/a255f747d63454e1219760b729d99e4778d56dda)) (@thisisnithin)

# [0.78.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.77.1...controlplane@0.78.0) (2024-03-18)

### Features

* allow to update admission url ([#638](https://github.com/wundergraph/cosmo/issues/638)) ([c7f7ee6](https://github.com/wundergraph/cosmo/commit/c7f7ee65f7716d463fb0bf96cf386e54ba5f8b73)) (@StarpTech)

## [0.77.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.77.0...controlplane@0.77.1) (2024-03-16)

### Bug Fixes

* improve ui and logs ([#631](https://github.com/wundergraph/cosmo/issues/631)) ([83695b9](https://github.com/wundergraph/cosmo/commit/83695b97d3aca66d70677bc207f874c8aa17bf65)) (@JivusAyrus)

# [0.77.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.76.0...controlplane@0.77.0) (2024-03-14)

### Features

* improve admission controller ([#632](https://github.com/wundergraph/cosmo/issues/632)) ([229bc9f](https://github.com/wundergraph/cosmo/commit/229bc9f5e58d0a936c2c5427b9f30146def87157)) (@StarpTech)

# [0.76.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.75.2...controlplane@0.76.0) (2024-03-14)

### Bug Fixes

* change claim key to support microsoft entra ([#630](https://github.com/wundergraph/cosmo/issues/630)) ([f1bc391](https://github.com/wundergraph/cosmo/commit/f1bc3916f9859525fd36e4879a839e6f3c59fa0d)) (@JivusAyrus)

### Features

* router config signature validation through custom admission webhooks ([#628](https://github.com/wundergraph/cosmo/issues/628)) ([384fd7e](https://github.com/wundergraph/cosmo/commit/384fd7e3372479e96fccc4fc771dc4e9f9c84754)) (@StarpTech)

## [0.75.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.75.1...controlplane@0.75.2) (2024-03-13)

**Note:** Version bump only for package controlplane

## [0.75.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.75.0...controlplane@0.75.1) (2024-03-11)

### Bug Fixes

* dependencies ([#622](https://github.com/wundergraph/cosmo/issues/622)) ([7763060](https://github.com/wundergraph/cosmo/commit/776306054ebb77a883779ae11ffd178b62afbd59)) (@JivusAyrus)

# [0.75.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.74.1...controlplane@0.75.0) (2024-03-11)

### Bug Fixes

* subgraphs not found in composition details page ([#619](https://github.com/wundergraph/cosmo/issues/619)) ([f3ea37e](https://github.com/wundergraph/cosmo/commit/f3ea37eb24a60b4f993437b728cf3b3db2166862)) (@JivusAyrus)

### Features

* add configurable schema linting ([#596](https://github.com/wundergraph/cosmo/issues/596)) ([c662485](https://github.com/wundergraph/cosmo/commit/c66248529c5bc13e795725c82ba50dbad79451ae)) (@JivusAyrus)

## [0.74.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.74.0...controlplane@0.74.1) (2024-03-08)

### Bug Fixes

* handle empty files in the cli itself ([#593](https://github.com/wundergraph/cosmo/issues/593)) ([de08e24](https://github.com/wundergraph/cosmo/commit/de08e24e63bc0083d3b86c417cb1bd282891c60b)) (@JivusAyrus)

# [0.74.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.73.2...controlplane@0.74.0) (2024-03-08)

### Features

* ensure TLS and test if mail client is ready ([#611](https://github.com/wundergraph/cosmo/issues/611)) ([0e62bec](https://github.com/wundergraph/cosmo/commit/0e62becf1583137025f712ca053ade946f62295e)) (@StarpTech)

## [0.73.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.73.1...controlplane@0.73.2) (2024-03-06)

**Note:** Version bump only for package controlplane

## [0.73.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.73.0...controlplane@0.73.1) (2024-03-05)

**Note:** Version bump only for package controlplane

# [0.73.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.72.0...controlplane@0.73.0) (2024-02-29)

### Features

* enrich logger for platform calls ([#579](https://github.com/wundergraph/cosmo/issues/579)) ([47836bf](https://github.com/wundergraph/cosmo/commit/47836bfd8a5d55195651928b4ea9c1f5e7bbf580)) (@thisisnithin)

# [0.72.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.71.1...controlplane@0.72.0) (2024-02-27)

### Bug Fixes

* omit invalid group filters ([#580](https://github.com/wundergraph/cosmo/issues/580)) ([c271e94](https://github.com/wundergraph/cosmo/commit/c271e9437e7a779dc7384f700a08e12e2a113c25)) (@thisisnithin)

### Features

* **cli:** new command to fetch latest published subgraph SDL ([#575](https://github.com/wundergraph/cosmo/issues/575)) ([09a0ab5](https://github.com/wundergraph/cosmo/commit/09a0ab54cccae6f46c1e585cf12fa9321f44e9ed)) (@StarpTech)
* show link to studio page on subgraph check ([#578](https://github.com/wundergraph/cosmo/issues/578)) ([701d81c](https://github.com/wundergraph/cosmo/commit/701d81c764b12bb1a2ec308634e69aaffb9e7e3e)) (@thisisnithin)

## [0.71.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.71.1...controlplane@0.71.2) (2024-02-23)

**Note:** Version bump only for package controlplane

## [0.71.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.71.0...controlplane@0.71.1) (2024-02-20)

**Note:** Version bump only for package controlplane

# [0.71.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.70.0...controlplane@0.71.0) (2024-02-20)

### Features

* implement slider for analytics duration ([#539](https://github.com/wundergraph/cosmo/issues/539)) ([3f4a0ee](https://github.com/wundergraph/cosmo/commit/3f4a0eeb58daa36ddf0be4bfc20959b53b6d0928)) (@JivusAyrus)

# [0.70.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.69.0...controlplane@0.70.0) (2024-02-20)

### Bug Fixes

* link to changelog in slack update ([#557](https://github.com/wundergraph/cosmo/issues/557)) ([300b4fc](https://github.com/wundergraph/cosmo/commit/300b4fcd6cce8142b19fade20ebd8fcc94317bd7)) (@thisisnithin)

### Features

* support empty labels and label matchers ([#555](https://github.com/wundergraph/cosmo/issues/555)) ([8bb857c](https://github.com/wundergraph/cosmo/commit/8bb857c94f8165676b2ca5101c199f3bc0648d10)) (@thisisnithin)

# [0.69.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.68.2...controlplane@0.69.0) (2024-02-19)

### Bug Fixes

* don't expose token on wgc list command ([#550](https://github.com/wundergraph/cosmo/issues/550)) ([357ffae](https://github.com/wundergraph/cosmo/commit/357ffae4362c3c37dc955d40363da40cd985bf3f)) (@StarpTech)
* send only summary for large slack notifications ([#556](https://github.com/wundergraph/cosmo/issues/556)) ([732dbc5](https://github.com/wundergraph/cosmo/commit/732dbc5cdf99c5ab742cf7dcf8339b516956bfdd)) (@thisisnithin)

### Features

* upgrade to latest gpt3.5 model ([#549](https://github.com/wundergraph/cosmo/issues/549)) ([3a44d02](https://github.com/wundergraph/cosmo/commit/3a44d022cd781fcd3435ac9f1d062597e51a2274)) (@StarpTech)

## [0.68.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.68.1...controlplane@0.68.2) (2024-02-18)

### Bug Fixes

* remove duplicated columns ([#547](https://github.com/wundergraph/cosmo/issues/547)) ([36e683a](https://github.com/wundergraph/cosmo/commit/36e683aa21dd8b5ae77ea8fda9d0d07b8e820733)) (@StarpTech)

## [0.68.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.68.0...controlplane@0.68.1) (2024-02-16)

### Bug Fixes

* import ([#544](https://github.com/wundergraph/cosmo/issues/544)) ([f2a3431](https://github.com/wundergraph/cosmo/commit/f2a34312b3b7c344d1255418f3c6a91f78fbf929)) (@thisisnithin)

# [0.68.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.67.3...controlplane@0.68.0) (2024-02-16)

### Features

* operation check overrides ([#516](https://github.com/wundergraph/cosmo/issues/516)) ([651ff8e](https://github.com/wundergraph/cosmo/commit/651ff8ed88cd542d56cf11d11086f659fc3f5d4e)) (@thisisnithin)

## [0.67.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.67.2...controlplane@0.67.3) (2024-02-15)

### Bug Fixes

* label matcher validation ([#529](https://github.com/wundergraph/cosmo/issues/529)) ([1472cbd](https://github.com/wundergraph/cosmo/commit/1472cbd0a4244fc835ab45d4a91fda64d984785d)) (@StarpTech)
* show subgraphs in the graph view after the creation itself ([#514](https://github.com/wundergraph/cosmo/issues/514)) ([d10b5b9](https://github.com/wundergraph/cosmo/commit/d10b5b973a1788f757249b441d08acbbda6b3f66)) (@JivusAyrus)

## [0.67.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.67.1...controlplane@0.67.2) (2024-02-14)

### Bug Fixes

* check for config version id when fetching router composition ([#525](https://github.com/wundergraph/cosmo/issues/525)) ([e86a794](https://github.com/wundergraph/cosmo/commit/e86a7945928826d16dbb461c16e301c51f8d345b)) (@StarpTech)

## [0.67.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.67.0...controlplane@0.67.1) (2024-02-13)

### Bug Fixes

* distinguish between server and process uptime, fix uptime ch query ([#520](https://github.com/wundergraph/cosmo/issues/520)) ([6fc2b72](https://github.com/wundergraph/cosmo/commit/6fc2b7237cd029127f6913199c40dd61bb16a22b)) (@StarpTech)

# [0.67.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.66.3...controlplane@0.67.0) (2024-02-13)

### Features

* router fleet management ([#515](https://github.com/wundergraph/cosmo/issues/515)) ([7f0deae](https://github.com/wundergraph/cosmo/commit/7f0deae98a2f58bd46927bdb2be8d615613b908f)) (@StarpTech)

## [0.66.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.66.2...controlplane@0.66.3) (2024-02-13)

**Note:** Version bump only for package controlplane

## [0.66.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.66.1...controlplane@0.66.2) (2024-02-08)

### Bug Fixes

* prepend ch queries correctly with database name ([#508](https://github.com/wundergraph/cosmo/issues/508)) ([f774638](https://github.com/wundergraph/cosmo/commit/f774638deee6e7d3c6c768fd7ad82ec48e398487)) (@StarpTech)
* rpm calculation in the graph overview page ([#507](https://github.com/wundergraph/cosmo/issues/507)) ([307e203](https://github.com/wundergraph/cosmo/commit/307e203b053ebe9b90a10d0ac10734adbdf398fc)) (@JivusAyrus)

## [0.66.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.66.0...controlplane@0.66.1) (2024-02-08)

### Bug Fixes

* slack update ([#510](https://github.com/wundergraph/cosmo/issues/510)) ([ee724e1](https://github.com/wundergraph/cosmo/commit/ee724e19dc47640c4213ea5d0af0c733bacd9c0b)) (@thisisnithin)

# [0.66.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.65.0...controlplane@0.66.0) (2024-02-08)

### Bug Fixes

* audit log for subgraph member addition and removal ([#498](https://github.com/wundergraph/cosmo/issues/498)) ([bd2a211](https://github.com/wundergraph/cosmo/commit/bd2a211b87594fcc43a1b893740d25fbff1b1729)) (@thisisnithin)
* wait until db is closed in close server hook ([#502](https://github.com/wundergraph/cosmo/issues/502)) ([8bb8686](https://github.com/wundergraph/cosmo/commit/8bb868651d39ceee1ecb4c62dd3b4ef3a143469f)) (@StarpTech)

### Features

* improve federated graph lists overview ([#497](https://github.com/wundergraph/cosmo/issues/497)) ([d7f383a](https://github.com/wundergraph/cosmo/commit/d7f383ad074a9dde06e96fd90459478a29b2cf79)) (@JivusAyrus)
* upgrade to active lts node images ([#501](https://github.com/wundergraph/cosmo/issues/501)) ([684f89f](https://github.com/wundergraph/cosmo/commit/684f89f8b6c46a3b24117c221cab41a5b60dd534)) (@StarpTech)

# [0.65.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.64.0...controlplane@0.65.0) (2024-02-06)

### Bug Fixes

* **traces:** avoid filter on service name when determining root ([ebec309](https://github.com/wundergraph/cosmo/commit/ebec30948e5bdaad2daa813834b34c7bf9c43192)) (@StarpTech)

### Features

* enable creating orgs without billing ([#491](https://github.com/wundergraph/cosmo/issues/491)) ([dd2a5b9](https://github.com/wundergraph/cosmo/commit/dd2a5b91fb715f20a4adc613b820de9f02220821)) (@JivusAyrus)

# [0.64.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.63.0...controlplane@0.64.0) (2024-02-06)

### Features

* add pagination component and validate limit ([#493](https://github.com/wundergraph/cosmo/issues/493)) ([880f1b9](https://github.com/wundergraph/cosmo/commit/880f1b9f64167b70b7f61620ebb5a895d438727a)) (@JivusAyrus)
* consider only router root spans in the trace list ([#495](https://github.com/wundergraph/cosmo/issues/495)) ([b7639ab](https://github.com/wundergraph/cosmo/commit/b7639abcc4c2f367a651a65ffbc17238a049f635)) (@StarpTech)

# [0.63.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.62.0...controlplane@0.63.0) (2024-02-05)

### Features

* allow to force root span on the router ([#486](https://github.com/wundergraph/cosmo/issues/486)) ([a1a2f64](https://github.com/wundergraph/cosmo/commit/a1a2f64558815267edc144e32da4297703743a86)) (@StarpTech)

# [0.62.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.61.2...controlplane@0.62.0) (2024-02-05)

### Bug Fixes

* missing namespace for platform operations ([#490](https://github.com/wundergraph/cosmo/issues/490)) ([647d52a](https://github.com/wundergraph/cosmo/commit/647d52a39877be73f55bc0d69c304576e9f5228a)) (@thisisnithin)
* refactor router trace instrumentation ([#485](https://github.com/wundergraph/cosmo/issues/485)) ([889d06c](https://github.com/wundergraph/cosmo/commit/889d06c95651bd44d136b89f0638faa4f25be8e2)) (@StarpTech)

### Features

* show span error and allow filter by span status code and trace id ([#484](https://github.com/wundergraph/cosmo/issues/484)) ([efc3243](https://github.com/wundergraph/cosmo/commit/efc32434a7de9b035d73ccc3efb736f0b69f9ac4)) (@StarpTech)

## [0.61.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.61.1...controlplane@0.61.2) (2024-02-02)

**Note:** Version bump only for package controlplane

## [0.61.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.61.0...controlplane@0.61.1) (2024-02-01)

### Bug Fixes

* support tls when migrate ([#479](https://github.com/wundergraph/cosmo/issues/479)) ([4e1b23c](https://github.com/wundergraph/cosmo/commit/4e1b23c052e99e94f516df334adcefe3bcd8caad)) (@StarpTech)

# [0.61.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.60.0...controlplane@0.61.0) (2024-02-01)

### Bug Fixes

* **deps:** upgrade bullmq ([#471](https://github.com/wundergraph/cosmo/issues/471)) ([90231c9](https://github.com/wundergraph/cosmo/commit/90231c9dd3af469dd0e6f6af05468c8e1112fa83)) (@StarpTech)
* slack notification link ([#478](https://github.com/wundergraph/cosmo/issues/478)) ([e83dfd8](https://github.com/wundergraph/cosmo/commit/e83dfd810cdbfdd927074b727ebab9435e380269)) (@thisisnithin)
* upgrade otel collector ([#475](https://github.com/wundergraph/cosmo/issues/475)) ([2d33978](https://github.com/wundergraph/cosmo/commit/2d339786d4cc1727b3fb6498606d11a059233b61)) (@StarpTech)

### Features

* integrate S3 when executing "getLatestValidRouterConfig" from the CLI ([#467](https://github.com/wundergraph/cosmo/issues/467)) ([90b7c8e](https://github.com/wundergraph/cosmo/commit/90b7c8ed01bdd659183c87cc2d94946ab20fe073)) (@JivusAyrus)

# [0.60.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.59.0...controlplane@0.60.0) (2024-01-31)

### Bug Fixes

* ch migrations ([#468](https://github.com/wundergraph/cosmo/issues/468)) ([5afda68](https://github.com/wundergraph/cosmo/commit/5afda68c8d0d65fa9adf64face1c6532f7d5174e)) (@JivusAyrus)
* validate routing urls ([#470](https://github.com/wundergraph/cosmo/issues/470)) ([166d9ef](https://github.com/wundergraph/cosmo/commit/166d9efb53f5554b1dcbd49f7dd334f6cc1e4a87)) (@JivusAyrus)

### Features

* cosmo ai, generate docs on publish ([#466](https://github.com/wundergraph/cosmo/issues/466)) ([033ff90](https://github.com/wundergraph/cosmo/commit/033ff9068716935a7d646adebcc0e2b776d0295d)) (@StarpTech)

# [0.59.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.58.0...controlplane@0.59.0) (2024-01-30)

### Features

* subgraph analytics page ([#455](https://github.com/wundergraph/cosmo/issues/455)) ([f7a65c7](https://github.com/wundergraph/cosmo/commit/f7a65c79611da2d7efc603ef7e5a5b2e194203c9)) (@JivusAyrus)

# [0.58.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.57.2...controlplane@0.58.0) (2024-01-30)

### Features

* implement authorization directives ([#448](https://github.com/wundergraph/cosmo/issues/448)) ([181d89d](https://github.com/wundergraph/cosmo/commit/181d89d8e7dbf8eb23cddfa0b6c91c840a2986b0)) (@Aenimus)

## [0.57.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.57.1...controlplane@0.57.2) (2024-01-29)

### Bug Fixes

* use graph id from token ([#463](https://github.com/wundergraph/cosmo/issues/463)) ([5582d00](https://github.com/wundergraph/cosmo/commit/5582d004c98eb20f62ecf2332b327c7959e5b64f)) (@thisisnithin)

## [0.57.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.57.0...controlplane@0.57.1) (2024-01-26)

### Bug Fixes

* allow to create subgraph and federated graphs with same name ([#461](https://github.com/wundergraph/cosmo/issues/461)) ([dcf0b7b](https://github.com/wundergraph/cosmo/commit/dcf0b7bb059f0fe05375955ace6859dcb9dada09)) (@StarpTech)

# [0.57.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.56.0...controlplane@0.57.0) (2024-01-26)

### Features

* namespaces ([#447](https://github.com/wundergraph/cosmo/issues/447)) ([bbe5258](https://github.com/wundergraph/cosmo/commit/bbe5258c5e764c52947f831d3a7f1a2f93c267d4)) (@thisisnithin)

# [0.56.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.55.0...controlplane@0.56.0) (2024-01-26)

### Features

* produce spans for handler and engine work ([#456](https://github.com/wundergraph/cosmo/issues/456)) ([fd5ad67](https://github.com/wundergraph/cosmo/commit/fd5ad678c184c34e1f09ff2e89664c53894ae74c)) (@StarpTech)

# [0.55.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.54.3...controlplane@0.55.0) (2024-01-23)

### Features

* implement pagination and date filter for audit logs ([#444](https://github.com/wundergraph/cosmo/issues/444)) ([e014c08](https://github.com/wundergraph/cosmo/commit/e014c0896dd017cf4db6a2c5f2c2d83b1fc86017)) (@JivusAyrus)

## [0.54.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.54.2...controlplane@0.54.3) (2024-01-21)

### Bug Fixes

* refresh button in the overview page ([#441](https://github.com/wundergraph/cosmo/issues/441)) ([d4988d9](https://github.com/wundergraph/cosmo/commit/d4988d9d3aecd377fc56af5cb2d33a69ba8414c5)) (@JivusAyrus)

## [0.54.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.54.1...controlplane@0.54.2) (2024-01-17)

### Bug Fixes

* organization_invitation.deleted event and set auditableType ([#439](https://github.com/wundergraph/cosmo/issues/439)) ([be4e38b](https://github.com/wundergraph/cosmo/commit/be4e38b86ded2848eefe89268caf6edd7a3a891d)) (@StarpTech)

## [0.54.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.54.0...controlplane@0.54.1) (2024-01-17)

### Bug Fixes

* allow the member of the org to leave ([#436](https://github.com/wundergraph/cosmo/issues/436)) ([21bd032](https://github.com/wundergraph/cosmo/commit/21bd032207752205d39a9a9568af704e4a069b89)) (@JivusAyrus)
* date and range filter for traces ([#437](https://github.com/wundergraph/cosmo/issues/437)) ([2950222](https://github.com/wundergraph/cosmo/commit/2950222c3b45134d9167fb43668ae32a4d2ec156)) (@thisisnithin)

# [0.54.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.53.2...controlplane@0.54.0) (2024-01-16)

### Features

* audit logs ([#424](https://github.com/wundergraph/cosmo/issues/424)) ([bb3aa46](https://github.com/wundergraph/cosmo/commit/bb3aa4632e28ed45c4fe1f8a0cc3e04acf0c194a)) (@StarpTech)

## [0.53.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.53.1...controlplane@0.53.2) (2024-01-12)

### Bug Fixes

* apollo migration ([#419](https://github.com/wundergraph/cosmo/issues/419)) ([2d43ce6](https://github.com/wundergraph/cosmo/commit/2d43ce68a023e80b06f5aaf6ba52da4fbf779fe1)) (@JivusAyrus)

## [0.53.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.53.0...controlplane@0.53.1) (2024-01-12)

### Bug Fixes

* delete organization ([#418](https://github.com/wundergraph/cosmo/issues/418)) ([916c35b](https://github.com/wundergraph/cosmo/commit/916c35b8f0b8721c237973242cd0863932759d95)) (@JivusAyrus)

# [0.53.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.52.4...controlplane@0.53.0) (2024-01-12)

### Features

* provide router config over cdn ([#411](https://github.com/wundergraph/cosmo/issues/411)) ([f04ac84](https://github.com/wundergraph/cosmo/commit/f04ac84d2f6c155409f7db69e7646c04047e32b5)) (@JivusAyrus)

## [0.52.4](https://github.com/wundergraph/cosmo/compare/controlplane@0.52.3...controlplane@0.52.4) (2024-01-11)

### Bug Fixes

* update organization details ([#413](https://github.com/wundergraph/cosmo/issues/413)) ([2ce3a32](https://github.com/wundergraph/cosmo/commit/2ce3a323016add67740f8be01694780529a9197c)) (@JivusAyrus)

## [0.52.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.52.2...controlplane@0.52.3) (2024-01-09)

**Note:** Version bump only for package controlplane

## [0.52.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.52.1...controlplane@0.52.2) (2024-01-09)

### Bug Fixes

* invite user ([#410](https://github.com/wundergraph/cosmo/issues/410)) ([56322b0](https://github.com/wundergraph/cosmo/commit/56322b0158b7b47367e21d1ae918cf1cac8b96d0)) (@JivusAyrus)

## [0.52.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.52.0...controlplane@0.52.1) (2024-01-09)

### Bug Fixes

* discussion improvements ([#408](https://github.com/wundergraph/cosmo/issues/408)) ([dce1c48](https://github.com/wundergraph/cosmo/commit/dce1c480c6c8dac97ec6e5dd7491375d4c00b73f)) (@thisisnithin)

# [0.52.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.51.0...controlplane@0.52.0) (2024-01-08)

### Features

* discussions ([#394](https://github.com/wundergraph/cosmo/issues/394)) ([3d81052](https://github.com/wundergraph/cosmo/commit/3d810521e552b3146a4a4b2cb5a13285aceb4476)) (@thisisnithin)

# [0.51.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.50.6...controlplane@0.51.0) (2024-01-06)

### Features

* track subgraphs in metrics ([#405](https://github.com/wundergraph/cosmo/issues/405)) ([7b9f307](https://github.com/wundergraph/cosmo/commit/7b9f3074ea718d49135c5f46943002e37bef48e2)) (@StarpTech)

## [0.50.6](https://github.com/wundergraph/cosmo/compare/controlplane@0.50.5...controlplane@0.50.6) (2024-01-01)

### Bug Fixes

* conflict on orgID, use org slug as customer name ([877c84c](https://github.com/wundergraph/cosmo/commit/877c84ca69866af7f54139b8ae9cdabc609e5418)) (@StarpTech)

## [0.50.5](https://github.com/wundergraph/cosmo/compare/controlplane@0.50.4...controlplane@0.50.5) (2024-01-01)

### Bug Fixes

* reset plan after subscription del, bill for upgrade immediately ([b649383](https://github.com/wundergraph/cosmo/commit/b649383446bf8a6187a61d795d4237604f401c87)) (@StarpTech)

## [0.50.4](https://github.com/wundergraph/cosmo/compare/controlplane@0.50.3...controlplane@0.50.4) (2024-01-01)

### Bug Fixes

* **payment:** handle customer deletion, cancel subs when org is deleted ([#401](https://github.com/wundergraph/cosmo/issues/401)) ([b58809d](https://github.com/wundergraph/cosmo/commit/b58809dca894a6aab879d1750bfd06a608da207f)) (@StarpTech)

## [0.50.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.50.2...controlplane@0.50.3) (2023-12-31)

### Bug Fixes

* scope plan update to organization ([684927e](https://github.com/wundergraph/cosmo/commit/684927ef26ec25450f3bfd022618c831350cd080)) (@StarpTech)

## [0.50.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.50.1...controlplane@0.50.2) (2023-12-31)

### Bug Fixes

* create keycloak groups when creating organization ([#400](https://github.com/wundergraph/cosmo/issues/400)) ([67be8a6](https://github.com/wundergraph/cosmo/commit/67be8a6a0b5df3a608367669dcb64c52ec1ec335)) (@StarpTech)

## [0.50.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.50.0...controlplane@0.50.1) (2023-12-31)

**Note:** Version bump only for package controlplane

# [0.50.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.49.0...controlplane@0.50.0) (2023-12-29)

### Bug Fixes

* avoid -1 in limits, ensure always limits ([#396](https://github.com/wundergraph/cosmo/issues/396)) ([fe7de2d](https://github.com/wundergraph/cosmo/commit/fe7de2d5d7b10d0b3ae8283b3d225b8df6cf1345)) (@StarpTech)
* make description optionally ([#395](https://github.com/wundergraph/cosmo/issues/395)) ([78c4bce](https://github.com/wundergraph/cosmo/commit/78c4bce26bd4439e8c37a91cb0d85d95e310612a)) (@StarpTech)

### Features

* remove deprecated columns ([#397](https://github.com/wundergraph/cosmo/issues/397)) ([35e456a](https://github.com/wundergraph/cosmo/commit/35e456a14ee0bfc57fc50c520787dc7f486e6b72)) (@Pagebakers)

# [0.49.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.48.0...controlplane@0.49.0) (2023-12-28)

### Features

* billing and limit refactoring ([#371](https://github.com/wundergraph/cosmo/issues/371)) ([0adfee1](https://github.com/wundergraph/cosmo/commit/0adfee146017a10c6e787a08723ef4d03ddf0f96)) (@Pagebakers)

# [0.48.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.47.3...controlplane@0.48.0) (2023-12-22)

### Features

* add readme for subgraphs and federated graphs ([#384](https://github.com/wundergraph/cosmo/issues/384)) ([260ffac](https://github.com/wundergraph/cosmo/commit/260ffac99d5c81b82991d1261b937cf4fa344949)) (@JivusAyrus)
* enable password policy and brute force protection ([#390](https://github.com/wundergraph/cosmo/issues/390)) ([0ab7032](https://github.com/wundergraph/cosmo/commit/0ab7032ca424ddb9e35280ebd45280e52889b0cd)) (@StarpTech)

## [0.47.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.47.2...controlplane@0.47.3) (2023-12-21)

**Note:** Version bump only for package controlplane

## [0.47.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.47.1...controlplane@0.47.2) (2023-12-19)

**Note:** Version bump only for package controlplane

## [0.47.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.47.0...controlplane@0.47.1) (2023-12-17)

### Bug Fixes

* po demo, await po upload ([#377](https://github.com/wundergraph/cosmo/issues/377)) ([ac0edd3](https://github.com/wundergraph/cosmo/commit/ac0edd3a3b1b6ce1192c7a355675b85f6187e72f)) (@StarpTech)

# [0.47.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.46.2...controlplane@0.47.0) (2023-12-15)

### Features

* add git commit sha to checks ([#361](https://github.com/wundergraph/cosmo/issues/361)) ([c9ef0c8](https://github.com/wundergraph/cosmo/commit/c9ef0c8439f89ffb80a4ed2f6c319a75414a07cf)) (@Pagebakers)

## [0.46.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.46.1...controlplane@0.46.2) (2023-12-14)

**Note:** Version bump only for package controlplane

## [0.46.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.46.0...controlplane@0.46.1) (2023-12-13)

**Note:** Version bump only for package controlplane

# [0.46.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.45.0...controlplane@0.46.0) (2023-12-12)

### Features

* implement foundations for entity interfaces ([#359](https://github.com/wundergraph/cosmo/issues/359)) ([e2fcec7](https://github.com/wundergraph/cosmo/commit/e2fcec7aa3f286159a1ad21d606ead41cf1c883e)) (@Aenimus)

# [0.45.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.44.0...controlplane@0.45.0) (2023-12-12)

### Bug Fixes

* api key resource deletion on delete of target ([#355](https://github.com/wundergraph/cosmo/issues/355)) ([a8fa0e8](https://github.com/wundergraph/cosmo/commit/a8fa0e8a06b129cf0a1b7dd07b2ef94e168007e3)) (@JivusAyrus)

### Features

* add rbac for subgraphs and federated graphs ([#351](https://github.com/wundergraph/cosmo/issues/351)) ([72e39bc](https://github.com/wundergraph/cosmo/commit/72e39bc1ff914831499c0625e443ab2ec0af135c)) (@JivusAyrus)

# [0.44.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.43.0...controlplane@0.44.0) (2023-12-09)

### Features

* extend graphqlmetrics chart ([#344](https://github.com/wundergraph/cosmo/issues/344)) ([bad337d](https://github.com/wundergraph/cosmo/commit/bad337d0f1fafab5772910b5cce97cab03992c38)) (@StarpTech)

# [0.43.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.42.0...controlplane@0.43.0) (2023-12-04)

### Bug Fixes

* filter out invalid filters ([#336](https://github.com/wundergraph/cosmo/issues/336)) ([777279e](https://github.com/wundergraph/cosmo/commit/777279eb252c8d7c754bedb2ac5e86bb94980b93)) (@Pagebakers)
* invitations ([#326](https://github.com/wundergraph/cosmo/issues/326)) ([8915cd8](https://github.com/wundergraph/cosmo/commit/8915cd80ab20285b768fa8af8b02e1572d452a40)) (@JivusAyrus)

### Features

* add compositions page ([#325](https://github.com/wundergraph/cosmo/issues/325)) ([fb7a018](https://github.com/wundergraph/cosmo/commit/fb7a0180579872c486bd59b6b3adc9c19f8f302d)) (@JivusAyrus)

# [0.42.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.41.2...controlplane@0.42.0) (2023-12-01)

### Bug Fixes

* minor bug fixes in ui ([#328](https://github.com/wundergraph/cosmo/issues/328)) ([6e77713](https://github.com/wundergraph/cosmo/commit/6e77713e93e413eb84af3e146dce1a1ec4511cff)) (@Pagebakers)

### Features

* persist ops from playground and view all client ops ([#323](https://github.com/wundergraph/cosmo/issues/323)) ([042d7db](https://github.com/wundergraph/cosmo/commit/042d7db00dbf2945a6be2b30e31d7851befc407b)) (@thisisnithin)
* restructure navigation ([#280](https://github.com/wundergraph/cosmo/issues/280)) ([df23357](https://github.com/wundergraph/cosmo/commit/df23357ceae0d7b37daf489a020f65777778e38b)) (@Pagebakers)

## [0.41.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.41.1...controlplane@0.41.2) (2023-11-30)

### Bug Fixes

* image releases ([230fcef](https://github.com/wundergraph/cosmo/commit/230fcef52db8c36dd54ee8b5568eb627811d4fb1)) (@StarpTech)

## [0.41.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.41.0...controlplane@0.41.1) (2023-11-30)

### Bug Fixes

* remove jwt payload from request token ([6dcda3c](https://github.com/wundergraph/cosmo/commit/6dcda3ca174a7c002ce2a0ab0ef3a1db18304d69)) (@StarpTech)

# [0.41.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.40.1...controlplane@0.41.0) (2023-11-30)

### Features

* register router on the controlplane ([#318](https://github.com/wundergraph/cosmo/issues/318)) ([10f86df](https://github.com/wundergraph/cosmo/commit/10f86dfebd80265d42015eaf3b9c15f941aef66b)) (@StarpTech)

## [0.40.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.40.0...controlplane@0.40.1) (2023-11-29)

**Note:** Version bump only for package controlplane

# [0.40.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.39.2...controlplane@0.40.0) (2023-11-29)

### Bug Fixes

* add migrations ([4592682](https://github.com/wundergraph/cosmo/commit/4592682f50160020e2600f4131f45d05b8c36fe9)) (@JivusAyrus)
* change path of invitations ([bf4f289](https://github.com/wundergraph/cosmo/commit/bf4f2899d415a1920cfdc47899475efbfb7f08fa)) (@JivusAyrus)
* ci ([eb1a3b6](https://github.com/wundergraph/cosmo/commit/eb1a3b66bf5b07b2eab6e446a4b0bf8e5ed518d0)) (@JivusAyrus)
* ci ([6486867](https://github.com/wundergraph/cosmo/commit/6486867cbbdd48a5c512204309188c6b836c9ca6)) (@JivusAyrus)
* invite flow rework ([c27f150](https://github.com/wundergraph/cosmo/commit/c27f15049fedff923b4bcb0f9e2effed874be408)) (@JivusAyrus)
* make mailer optional ([a14adb5](https://github.com/wundergraph/cosmo/commit/a14adb5ac8cac9b5e7e9426c32b6ca9dc0ad5c5e)) (@JivusAyrus)
* pr suggestions ([1397969](https://github.com/wundergraph/cosmo/commit/1397969ea6b17b2830f5c8fa45cc70f2bc45f68b)) (@JivusAyrus)
* pr suggestions ([67a76a0](https://github.com/wundergraph/cosmo/commit/67a76a034b67dce5caf25d96bca8ca0942a60c9e)) (@JivusAyrus)
* pr suggestions ([c719b5e](https://github.com/wundergraph/cosmo/commit/c719b5e9394c2899e53244592feabd6b3ca1d227)) (@JivusAyrus)
* remove migrations ([11283c5](https://github.com/wundergraph/cosmo/commit/11283c54e45b063efd95e83cba66f76373b98d91)) (@JivusAyrus)

### Features

* accept custom operation IDs for persisted operations ([#302](https://github.com/wundergraph/cosmo/issues/302)) ([a535a62](https://github.com/wundergraph/cosmo/commit/a535a62bb7f70d2e58d1a04066fb74e78d932653)) (@fiam)
* add new invitations table ([5d96c18](https://github.com/wundergraph/cosmo/commit/5d96c1807700d75fdf9c2a91dcf082170c5bc522)) (@JivusAyrus)

## [0.39.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.39.1...controlplane@0.39.2) (2023-11-28)

**Note:** Version bump only for package controlplane

## [0.39.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.39.0...controlplane@0.39.1) (2023-11-27)

### Bug Fixes

* store JSONB as json, avoid custom log in automaxprocs ([#301](https://github.com/wundergraph/cosmo/issues/301)) ([c6a1486](https://github.com/wundergraph/cosmo/commit/c6a1486a69c383f247e0d3eb3723d883633b8780)) (@StarpTech)

# [0.39.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.37.2...controlplane@0.39.0) (2023-11-23)

### Features

* add organization limits ([#285](https://github.com/wundergraph/cosmo/issues/285)) ([52a5664](https://github.com/wundergraph/cosmo/commit/52a566400dfa111a78a4bbdcf0a824dd2205da2d)) (@JivusAyrus)
* add support for persisted operations ([#249](https://github.com/wundergraph/cosmo/issues/249)) ([a9ad47f](https://github.com/wundergraph/cosmo/commit/a9ad47ff5cf7db6bccf774e168b1d1ce3ee7bcdd)) (@fiam)

# [0.38.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.37.2...controlplane@0.38.0) (2023-11-23)

### Features

* add organization limits ([#285](https://github.com/wundergraph/cosmo/issues/285)) ([52a5664](https://github.com/wundergraph/cosmo/commit/52a566400dfa111a78a4bbdcf0a824dd2205da2d)) (@JivusAyrus)
* add support for persisted operations ([#249](https://github.com/wundergraph/cosmo/issues/249)) ([a9ad47f](https://github.com/wundergraph/cosmo/commit/a9ad47ff5cf7db6bccf774e168b1d1ce3ee7bcdd)) (@fiam)

## [0.37.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.37.1...controlplane@0.37.2) (2023-11-20)

### Bug Fixes

* move to bitnami charts and exit 1 on migration issues ([#275](https://github.com/wundergraph/cosmo/issues/275)) ([90d9d93](https://github.com/wundergraph/cosmo/commit/90d9d938cefdc78a9f34d69387f306b4d691c7f0)) (@StarpTech)
* remove unnecessary fields and add populate the createdBy for compositions ([#272](https://github.com/wundergraph/cosmo/issues/272)) ([82b716c](https://github.com/wundergraph/cosmo/commit/82b716cb629e4c84e5cf45461951594abab9df6b)) (@JivusAyrus)

## [0.37.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.37.0...controlplane@0.37.1) (2023-11-17)

### Bug Fixes

* show latest valid subgraph schema ([#259](https://github.com/wundergraph/cosmo/issues/259)) ([d954b91](https://github.com/wundergraph/cosmo/commit/d954b91bd212ae1a33257c662a4ff8a2ac8c2b56)) (@JivusAyrus)

# [0.37.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.36.0...controlplane@0.37.0) (2023-11-15)

### Features

* consider input and argument usage for breaking change detection ([#255](https://github.com/wundergraph/cosmo/issues/255)) ([e10ac40](https://github.com/wundergraph/cosmo/commit/e10ac401f543f5540b5ada8f80533ddfbd0bc728)) (@jensneuse)

# [0.36.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.35.0...controlplane@0.36.0) (2023-11-15)

### Bug Fixes

* remove 10 day limit for free trial ([#260](https://github.com/wundergraph/cosmo/issues/260)) ([9e59f58](https://github.com/wundergraph/cosmo/commit/9e59f583cd7195a74012795e3e2401ae9cae4bfb)) (@JivusAyrus)

### Features

* add check for deleted subgraphs ([#258](https://github.com/wundergraph/cosmo/issues/258)) ([ba87fe5](https://github.com/wundergraph/cosmo/commit/ba87fe51631ece9c2efaea6350dc93590f1846c5)) (@Pagebakers)

# [0.35.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.34.0...controlplane@0.35.0) (2023-11-10)

### Features

* implement [@override](https://github.com/override) ([#246](https://github.com/wundergraph/cosmo/issues/246)) ([b6d0448](https://github.com/wundergraph/cosmo/commit/b6d044861e918f7c82931e1d5374fc7f6fc01daa)) (@Aenimus)

# [0.34.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.33.0...controlplane@0.34.0) (2023-11-09)

### Features

* unify and redesign login screen ([#250](https://github.com/wundergraph/cosmo/issues/250)) ([aa02c4a](https://github.com/wundergraph/cosmo/commit/aa02c4a5eb2b85cea811b896494ed5d1f2762416)) (@Pagebakers)

# [0.33.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.32.0...controlplane@0.33.0) (2023-11-09)

### Bug Fixes

* invalid org slug ([#248](https://github.com/wundergraph/cosmo/issues/248)) ([c6c01a0](https://github.com/wundergraph/cosmo/commit/c6c01a0aa4c81ae54117aef273438fe99e21dcba)) (@thisisnithin)
* minor issues of sso ([#247](https://github.com/wundergraph/cosmo/issues/247)) ([8bf61a9](https://github.com/wundergraph/cosmo/commit/8bf61a90751cf3b4aed3783cf07bab2560acac10)) (@JivusAyrus)

### Features

* link operations through hash ([#244](https://github.com/wundergraph/cosmo/issues/244)) ([24a7738](https://github.com/wundergraph/cosmo/commit/24a773884947c58183ee56bb9be82e2fae1c0bff)) (@thisisnithin)

# [0.32.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.31.1...controlplane@0.32.0) (2023-11-08)

### Features

* implement sso & basic RBAC in Cosmo ([#220](https://github.com/wundergraph/cosmo/issues/220)) ([55af35b](https://github.com/wundergraph/cosmo/commit/55af35b14068441d1df219599874a575dedb9dc2)) (@JivusAyrus)

## [0.31.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.31.0...controlplane@0.31.1) (2023-11-07)

### Bug Fixes

* optimize analytics filter queries ([#242](https://github.com/wundergraph/cosmo/issues/242)) ([23bc1f4](https://github.com/wundergraph/cosmo/commit/23bc1f4cdafcb0d0559a06e827992186d9d4f4c0)) (@Pagebakers)

# [0.31.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.30.0...controlplane@0.31.0) (2023-11-06)

### Features

* **controlplane:** avoid downloading config for latest check ([#236](https://github.com/wundergraph/cosmo/issues/236)) ([1929554](https://github.com/wundergraph/cosmo/commit/1929554e158548972cddacd3a59bca81133434a1)) (@StarpTech)
* upgrade to stable connect & react-query 5 ([#231](https://github.com/wundergraph/cosmo/issues/231)) ([0c434eb](https://github.com/wundergraph/cosmo/commit/0c434eb41b357f596d19607cd2c8572f6a9899a1)) (@StarpTech)

# [0.30.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.29.0...controlplane@0.30.0) (2023-11-03)

### Features

* use ch query cache for point query ([#228](https://github.com/wundergraph/cosmo/issues/228)) ([03a34e4](https://github.com/wundergraph/cosmo/commit/03a34e482cbbd24570be8dbc574e186d1680f62c)) (@StarpTech)

# [0.29.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.28.2...controlplane@0.29.0) (2023-11-03)

### Bug Fixes

* date picker improvements ([#226](https://github.com/wundergraph/cosmo/issues/226)) ([9b784cf](https://github.com/wundergraph/cosmo/commit/9b784cf2180fb59f152ab9d8296e7026e1461c9c)) (@Pagebakers)

### Features

* add ranges to date picker ([#210](https://github.com/wundergraph/cosmo/issues/210)) ([3dac117](https://github.com/wundergraph/cosmo/commit/3dac1179b6e78f2bf2ee5f40c735463e96ef980d)) (@Pagebakers)
* operation checks (breaking change detection) ([#214](https://github.com/wundergraph/cosmo/issues/214)) ([0935413](https://github.com/wundergraph/cosmo/commit/093541305866327c5c44637603621e4a8053640d)) (@StarpTech)

## [0.28.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.28.1...controlplane@0.28.2) (2023-11-02)

### Bug Fixes

* don't consider dangerous change as breaking ([#222](https://github.com/wundergraph/cosmo/issues/222)) ([6d4bdc0](https://github.com/wundergraph/cosmo/commit/6d4bdc0261484426408db81f6ad11842563e8054)) (@StarpTech)

## [0.28.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.28.0...controlplane@0.28.1) (2023-10-26)

**Note:** Version bump only for package controlplane

# [0.28.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.27.1...controlplane@0.28.0) (2023-10-25)

### Features

* schema field level usage analytics ([#174](https://github.com/wundergraph/cosmo/issues/174)) ([4f257a7](https://github.com/wundergraph/cosmo/commit/4f257a71984e991be2304b09a083c69da65200d2)) (@StarpTech)

## [0.27.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.27.0...controlplane@0.27.1) (2023-10-25)

### Bug Fixes

* follow GraphQL over HTTP in error handling ([#199](https://github.com/wundergraph/cosmo/issues/199)) ([8006267](https://github.com/wundergraph/cosmo/commit/800626773929923299ed88af44c50b187287cd25)) (@StarpTech)

# [0.27.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.26.0...controlplane@0.27.0) (2023-10-23)

### Features

* allow to upsert a subgraph on publish ([#196](https://github.com/wundergraph/cosmo/issues/196)) ([27a1630](https://github.com/wundergraph/cosmo/commit/27a1630574e817412a6d5fb2b304da645a31d481)) (@StarpTech)

# [0.26.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.25.0...controlplane@0.26.0) (2023-10-20)

### Bug Fixes

* **controlplane:** check array length ([#193](https://github.com/wundergraph/cosmo/issues/193)) ([51fd191](https://github.com/wundergraph/cosmo/commit/51fd19140c5a037baab7ca32b1d0877485c0848c)) (@StarpTech)
* redirect the user to the correct page after login ([#192](https://github.com/wundergraph/cosmo/issues/192)) ([c5e28ed](https://github.com/wundergraph/cosmo/commit/c5e28edc0495c45497a5dd1373bf9f7784cf84a1)) (@JivusAyrus)

### Features

* add client name client version filter for analytics and ([#181](https://github.com/wundergraph/cosmo/issues/181)) ([6180f4d](https://github.com/wundergraph/cosmo/commit/6180f4d621c383e72883c3cfa10ac1119da91761)) (@Pagebakers)
* add support for subscriptions ([#185](https://github.com/wundergraph/cosmo/issues/185)) ([5a78aa0](https://github.com/wundergraph/cosmo/commit/5a78aa01f60ac4184ac69b0bd72aa1ce467bff93)) (@fiam)
* auto ignore schema errors for check command if github is integrated ([#184](https://github.com/wundergraph/cosmo/issues/184)) ([05d1b4a](https://github.com/wundergraph/cosmo/commit/05d1b4a4fcb836013c8db49796c174eba0c96744)) (@thisisnithin)

# [0.25.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.24.2...controlplane@0.25.0) (2023-10-13)

### Features

* implement slack notifications ([#175](https://github.com/wundergraph/cosmo/issues/175)) ([87c30ec](https://github.com/wundergraph/cosmo/commit/87c30ec86fcd7090b33cbf274bd126534992857f)) (@JivusAyrus)

## [0.24.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.24.1...controlplane@0.24.2) (2023-10-11)

### Bug Fixes

* migration and add logs on error ([#171](https://github.com/wundergraph/cosmo/issues/171)) ([ea14203](https://github.com/wundergraph/cosmo/commit/ea14203f392d90d98c1d2f61374de9093842b5cb)) (@JivusAyrus)

## [0.24.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.24.0...controlplane@0.24.1) (2023-10-09)

### Bug Fixes

* update schema and config on subgraph update ([#173](https://github.com/wundergraph/cosmo/issues/173)) ([1e69e52](https://github.com/wundergraph/cosmo/commit/1e69e52e5657c71c7e23118aa570067d372bf5b7)) (@thisisnithin)

# [0.24.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.23.0...controlplane@0.24.0) (2023-10-09)

### Bug Fixes

* ui improvements ([#170](https://github.com/wundergraph/cosmo/issues/170)) ([fffd3e2](https://github.com/wundergraph/cosmo/commit/fffd3e2b7d9a82e7b809214a7ce836cce83f54b9)) (@thisisnithin)

### Features

* use metric data for dashboard stats ([#169](https://github.com/wundergraph/cosmo/issues/169)) ([e25fe32](https://github.com/wundergraph/cosmo/commit/e25fe32cdc053d658b0b0cdcd819b039be3341e6)) (@StarpTech)

# [0.23.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.22.0...controlplane@0.23.0) (2023-10-06)

### Bug Fixes

* log platform webhook failure as error ([#159](https://github.com/wundergraph/cosmo/issues/159)) ([d8422a4](https://github.com/wundergraph/cosmo/commit/d8422a42cd1aebe53cf0c446dcd63a35e56d3f88)) (@thisisnithin)

### Features

* display router initiation command ([#158](https://github.com/wundergraph/cosmo/issues/158)) ([284200b](https://github.com/wundergraph/cosmo/commit/284200b5ebae35a348fef1a650d268800f3887ac)) (@JivusAyrus)
* use clickhouse as metric storage ([#137](https://github.com/wundergraph/cosmo/issues/137)) ([c5e9bf4](https://github.com/wundergraph/cosmo/commit/c5e9bf4b74d32f3cae7da27b6170300c1a462e52)) (@StarpTech)
* version metric meter ([#160](https://github.com/wundergraph/cosmo/issues/160)) ([1cdb5d5](https://github.com/wundergraph/cosmo/commit/1cdb5d5f62a9e49d2950b37144e547a153285038)) (@StarpTech)

# [0.22.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.21.0...controlplane@0.22.0) (2023-10-05)

### Features

* configurable webhook events ([#149](https://github.com/wundergraph/cosmo/issues/149)) ([54836cc](https://github.com/wundergraph/cosmo/commit/54836cc5cb5a4fb46817ec04e82bfafaa134d59c)) (@thisisnithin)
* implement list and delete router tokens ([#146](https://github.com/wundergraph/cosmo/issues/146)) ([72543f7](https://github.com/wundergraph/cosmo/commit/72543f796c66d155782cd90bc4828803fbb971c7)) (@JivusAyrus)

# [0.21.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.20.0...controlplane@0.21.0) (2023-10-04)

### Bug Fixes

* flickering issue on change of orgs ([#147](https://github.com/wundergraph/cosmo/issues/147)) ([eadbb77](https://github.com/wundergraph/cosmo/commit/eadbb775e63cd10488c21079fed14e59771249c7)) (@JivusAyrus)

### Features

* github app integration ([#140](https://github.com/wundergraph/cosmo/issues/140)) ([783a1f9](https://github.com/wundergraph/cosmo/commit/783a1f9c3f42284d1bf6cfa0d8fd46971724500a)) (@thisisnithin)
* handle multiple orgs in the cli ([#145](https://github.com/wundergraph/cosmo/issues/145)) ([77234c9](https://github.com/wundergraph/cosmo/commit/77234c979e117473bf8429c0cd0e4d4c888eb81d)) (@JivusAyrus)

# [0.20.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.19.1...controlplane@0.20.0) (2023-09-29)

### Features

* implement leave and delete organization ([#112](https://github.com/wundergraph/cosmo/issues/112)) ([59bc44f](https://github.com/wundergraph/cosmo/commit/59bc44f53cbc72d492cf0e07e75d7e62e7c68b61)) (@JivusAyrus)
* improve trail version banner and handle trial version expiry ([#138](https://github.com/wundergraph/cosmo/issues/138)) ([0ecb2d1](https://github.com/wundergraph/cosmo/commit/0ecb2d150d9f9906631168aa0f588d2ca64ab590)) (@JivusAyrus)

## [0.19.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.19.0...controlplane@0.19.1) (2023-09-28)

### Bug Fixes

* use correct range for error rate queries ([#133](https://github.com/wundergraph/cosmo/issues/133)) ([ff0b004](https://github.com/wundergraph/cosmo/commit/ff0b004fd6cf4f08540f76c858ea6dfaebcdd70e)) (@Pagebakers)

# [0.19.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.18.1...controlplane@0.19.0) (2023-09-27)

### Features

* add 1 and 4 hour ranges, refresh button and minor improvements ([#128](https://github.com/wundergraph/cosmo/issues/128)) ([f5cbfc7](https://github.com/wundergraph/cosmo/commit/f5cbfc79f23d0a1bbbbb1a910d82ff5894a0240d)) (@Pagebakers)

## [0.18.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.18.0...controlplane@0.18.1) (2023-09-27)

### Bug Fixes

* remove member ([#129](https://github.com/wundergraph/cosmo/issues/129)) ([6d7a478](https://github.com/wundergraph/cosmo/commit/6d7a4780b3b5da8efe8413f015d9df07f492efef)) (@JivusAyrus)

# [0.18.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.17.2...controlplane@0.18.0) (2023-09-27)

### Features

* support being a part of multiple organizations ([#119](https://github.com/wundergraph/cosmo/issues/119)) ([338e336](https://github.com/wundergraph/cosmo/commit/338e336a75435e150c8acfb01b88a8a086f7000a)) (@JivusAyrus)

## [0.17.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.17.1...controlplane@0.17.2) (2023-09-26)

### Bug Fixes

* sanitize migrated graph label ([#124](https://github.com/wundergraph/cosmo/issues/124)) ([563e090](https://github.com/wundergraph/cosmo/commit/563e090adb1ab69fc96153ac226e391a5c609ff0)) (@Aenimus)

## [0.17.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.17.0...controlplane@0.17.1) (2023-09-26)

### Bug Fixes

* range in error query ([#120](https://github.com/wundergraph/cosmo/issues/120)) ([48d73ea](https://github.com/wundergraph/cosmo/commit/48d73ea9198d3ecbae00caaf928ba2d2d97ea0d8)) (@Pagebakers)

# [0.17.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.16.2...controlplane@0.17.0) (2023-09-25)

### Features

* **controlplane:** use datetime formatted logs ([#118](https://github.com/wundergraph/cosmo/issues/118)) ([ea00e97](https://github.com/wundergraph/cosmo/commit/ea00e974b32ba752b10c0a2efeec932c1e22009e)) (@StarpTech)
* implement get changelog cli command ([#117](https://github.com/wundergraph/cosmo/issues/117)) ([ffaad09](https://github.com/wundergraph/cosmo/commit/ffaad093a212a6340263c4223452fb9edfec7570)) (@thisisnithin)

## [0.16.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.16.1...controlplane@0.16.2) (2023-09-25)

### Bug Fixes

* improved analytics queries and output ([#115](https://github.com/wundergraph/cosmo/issues/115)) ([c0d4b9d](https://github.com/wundergraph/cosmo/commit/c0d4b9d2392aac205d6671e1c8c418de8eb40cf4)) (@Pagebakers)

## [0.16.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.16.0...controlplane@0.16.1) (2023-09-25)

### Bug Fixes

* metrics repository and ui ([#113](https://github.com/wundergraph/cosmo/issues/113)) ([549ac6c](https://github.com/wundergraph/cosmo/commit/549ac6cd88e148ed9924d427ca306eb832cdd2ec)) (@thisisnithin)

# [0.16.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.15.0...controlplane@0.16.0) (2023-09-25)

### Features

* advanced analytics ([#99](https://github.com/wundergraph/cosmo/issues/99)) ([a7a3058](https://github.com/wundergraph/cosmo/commit/a7a305851faa868d30dc202eef197afc6065ce92)) (@Pagebakers)

# [0.15.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.14.0...controlplane@0.15.0) (2023-09-21)

### Features

* add login command ([#95](https://github.com/wundergraph/cosmo/issues/95)) ([e9da8c3](https://github.com/wundergraph/cosmo/commit/e9da8c3c9e018029e0aef06d3b3b823732812a47)) (@JivusAyrus)
* changelog pagination ([#103](https://github.com/wundergraph/cosmo/issues/103)) ([614b57e](https://github.com/wundergraph/cosmo/commit/614b57ed4904dde04682e75ad80670f08f64b7b2)) (@thisisnithin)
* don't poll router config when config hasn't changed ([#105](https://github.com/wundergraph/cosmo/issues/105)) ([ea33961](https://github.com/wundergraph/cosmo/commit/ea339617a7d1724fd9b727953db5d591e50241dd)) (@StarpTech)

# [0.14.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.13.2...controlplane@0.14.0) (2023-09-20)

### Features

* store subgraphs in router config ([#61](https://github.com/wundergraph/cosmo/issues/61)) ([de7b132](https://github.com/wundergraph/cosmo/commit/de7b13244755acd49c38ff1e6c537234ab506960)) (@thisisnithin)

## [0.13.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.13.1...controlplane@0.13.2) (2023-09-19)

**Note:** Version bump only for package controlplane

## [0.13.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.13.0...controlplane@0.13.1) (2023-09-18)

**Note:** Version bump only for package controlplane

# [0.13.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.12.1...controlplane@0.13.0) (2023-09-18)

### Features

* only log system errors as errors ([#80](https://github.com/wundergraph/cosmo/issues/80)) ([127614c](https://github.com/wundergraph/cosmo/commit/127614c889c6a98c3dc4963a502ef82fae3362d0)) (@StarpTech)

## [0.12.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.12.0...controlplane@0.12.1) (2023-09-17)

### Bug Fixes

* api key last used update ([#77](https://github.com/wundergraph/cosmo/issues/77)) ([d02cb22](https://github.com/wundergraph/cosmo/commit/d02cb22624b5d37862f4b4c1b0c8f413855bbb40)) (@thisisnithin)

# [0.12.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.11.3...controlplane@0.12.0) (2023-09-16)

### Features

* only generate node api for router ([#76](https://github.com/wundergraph/cosmo/issues/76)) ([9307648](https://github.com/wundergraph/cosmo/commit/93076481437030fa6e348dccbc74591f91878f57)) (@StarpTech)
* webhooks ([#66](https://github.com/wundergraph/cosmo/issues/66)) ([dbb281f](https://github.com/wundergraph/cosmo/commit/dbb281fda114ddb6be309b3336d0668d705e7bc9)) (@thisisnithin)

## [0.11.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.11.2...controlplane@0.11.3) (2023-09-15)

### Bug Fixes

* reduce error logs ([#72](https://github.com/wundergraph/cosmo/issues/72)) ([cba6fef](https://github.com/wundergraph/cosmo/commit/cba6fefe854bc3852708fd6a37eb5fa07d7fea24)) (@StarpTech)

## [0.11.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.11.1...controlplane@0.11.2) (2023-09-14)

### Bug Fixes

* avoid excessive error logs in session handler ([#70](https://github.com/wundergraph/cosmo/issues/70)) ([ed5a4c5](https://github.com/wundergraph/cosmo/commit/ed5a4c515b5d3bf6d5776e53a9ffe70bd474a418)) (@StarpTech)

## [0.11.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.11.0...controlplane@0.11.1) (2023-09-14)

### Bug Fixes

* labels of the migrated graphs ([#65](https://github.com/wundergraph/cosmo/issues/65)) ([6ca790c](https://github.com/wundergraph/cosmo/commit/6ca790c7c73e66fc0d51bd6f79fc4899a8686064)) (@JivusAyrus)

# [0.11.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.10.1...controlplane@0.11.0) (2023-09-13)

### Features

* add user registration ([#57](https://github.com/wundergraph/cosmo/issues/57)) ([c1d1841](https://github.com/wundergraph/cosmo/commit/c1d184192511f015c4b33db91d7342a0bb35710e)) (@JivusAyrus)
* use materialized views for traces ([#51](https://github.com/wundergraph/cosmo/issues/51)) ([f1bfbf5](https://github.com/wundergraph/cosmo/commit/f1bfbf5950ba92adbfeae5a3d4ef0cab14363150)) (@thisisnithin)

## [0.10.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.10.0...controlplane@0.10.1) (2023-09-11)

**Note:** Version bump only for package controlplane

# [0.10.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.9.4...controlplane@0.10.0) (2023-09-11)

### Features

* add introspect subgraph command ([#44](https://github.com/wundergraph/cosmo/issues/44)) ([bf376cd](https://github.com/wundergraph/cosmo/commit/bf376cd75382b16659efb670ea54494f691328aa)) (@JivusAyrus)
* introspect subgraphs in cli ([#53](https://github.com/wundergraph/cosmo/issues/53)) ([2bd9f95](https://github.com/wundergraph/cosmo/commit/2bd9f95cd3ac13e878a12ab526d575c9b1daf248)) (@JivusAyrus)

## [0.9.4](https://github.com/wundergraph/cosmo/compare/controlplane@0.9.3...controlplane@0.9.4) (2023-09-08)

**Note:** Version bump only for package controlplane

## [0.9.3](https://github.com/wundergraph/cosmo/compare/controlplane@0.9.2...controlplane@0.9.3) (2023-09-07)

**Note:** Version bump only for package controlplane

## [0.9.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.9.1...controlplane@0.9.2) (2023-09-06)

### Bug Fixes

* take variant name as input while migrating ([#40](https://github.com/wundergraph/cosmo/issues/40)) ([6ace9fc](https://github.com/wundergraph/cosmo/commit/6ace9fc93c246dce3fce641a2e274e93d99ae813)) (@JivusAyrus)

## [0.9.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.9.0...controlplane@0.9.1) (2023-09-06)

### Bug Fixes

* support firefox and other browsers by adding user agent to the allowed headers ([#39](https://github.com/wundergraph/cosmo/issues/39)) ([11be0dc](https://github.com/wundergraph/cosmo/commit/11be0dc0145c08d5aaf5b1919b2529e26f3e397b)) (@JivusAyrus)

# [0.9.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.8.0...controlplane@0.9.0) (2023-09-06)

### Features

* add argument configuration ([#10](https://github.com/wundergraph/cosmo/issues/10)) ([48d909f](https://github.com/wundergraph/cosmo/commit/48d909f4de954c2401b557ed6a9f58915388f679)) (@Aenimus)
* add pagination and date range filter for schema checks ([#35](https://github.com/wundergraph/cosmo/issues/35)) ([e7bbc04](https://github.com/wundergraph/cosmo/commit/e7bbc04f76180cfe4210f173697f323b34650e41)) (@JivusAyrus)
* implement whoami cli command ([#33](https://github.com/wundergraph/cosmo/issues/33)) ([c920b25](https://github.com/wundergraph/cosmo/commit/c920b25ff4dc31cf9788b1590e3c89e4a33a3ac0)) (@StarpTech)
* move to new connectrpc packages ([#32](https://github.com/wundergraph/cosmo/issues/32)) ([4c8423b](https://github.com/wundergraph/cosmo/commit/4c8423bf377b63af6a42a42d7d5fc1ce2db1f09e)) (@StarpTech)

# [0.8.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.7.1...controlplane@0.8.0) (2023-09-02)

### Features

* add prometheus ([#31](https://github.com/wundergraph/cosmo/issues/31)) ([d318c73](https://github.com/wundergraph/cosmo/commit/d318c7331d77d21d0246344d76fbe0fc6b617174)) (@StarpTech)

## [0.7.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.7.0...controlplane@0.7.1) (2023-08-31)

### Bug Fixes

* modify seed script ([#28](https://github.com/wundergraph/cosmo/issues/28)) ([7dba7ee](https://github.com/wundergraph/cosmo/commit/7dba7eed828648254be04d9f70585f2b930cd657)) (@JivusAyrus)

# [0.7.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.6.2...controlplane@0.7.0) (2023-08-31)

### Bug Fixes

* analytics view and get trace query ([#23](https://github.com/wundergraph/cosmo/issues/23)) ([916488b](https://github.com/wundergraph/cosmo/commit/916488b697fa8f446e7aaa3d3f4b3e504671a23b)) (@JivusAyrus)
* throw auth error inside try, allow to customize k8s probes, use … ([#24](https://github.com/wundergraph/cosmo/issues/24)) ([2d5695b](https://github.com/wundergraph/cosmo/commit/2d5695b95adad9b2fd8a6cacbc2dd2a1c2cb9bd6)) (@StarpTech)

### Features

* migrate graphs from apollo ([#17](https://github.com/wundergraph/cosmo/issues/17)) ([0d9d025](https://github.com/wundergraph/cosmo/commit/0d9d025adadf11fd0516cbe10f470765757a9853)) (@JivusAyrus)

## [0.6.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.6.1...controlplane@0.6.2) (2023-08-29)

**Note:** Version bump only for package controlplane

## [0.6.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.6.0...controlplane@0.6.1) (2023-08-29)

### Bug Fixes

* improvements ([#18](https://github.com/wundergraph/cosmo/issues/18)) ([fdf2b29](https://github.com/wundergraph/cosmo/commit/fdf2b290ec57e502d8011e29e06a067d32afdf18)) (@JivusAyrus)

# [0.6.0](https://github.com/wundergraph/cosmo/compare/controlplane@0.5.0...controlplane@0.6.0) (2023-08-28)

### Bug Fixes

* by subgraph query ([#9](https://github.com/wundergraph/cosmo/issues/9)) ([fdec00e](https://github.com/wundergraph/cosmo/commit/fdec00edd47c22f77cfc79a89a16764170a38b2d)) (@StarpTech)
* ui ([#4](https://github.com/wundergraph/cosmo/issues/4)) ([2be4987](https://github.com/wundergraph/cosmo/commit/2be4987d8707be3c2b42d72f12e8db0b91b525b2)) (@JivusAyrus)
* use materialized view when fetching traces ([#16](https://github.com/wundergraph/cosmo/issues/16)) ([e4ed267](https://github.com/wundergraph/cosmo/commit/e4ed267c91f4b97f10c92ed19a4498dd6684241c)) (@StarpTech)

### Features

* add resend invitation and remove member/invitation functionality ([#2](https://github.com/wundergraph/cosmo/issues/2)) ([7528ba3](https://github.com/wundergraph/cosmo/commit/7528ba3f6456be40769ea314b3b36a26a10e852b)) (@JivusAyrus)
* implement metric backend ([#13](https://github.com/wundergraph/cosmo/issues/13)) ([4c0a790](https://github.com/wundergraph/cosmo/commit/4c0a790852542475e6d0533fdeea24f5b226bd7d)) (@StarpTech)

# 0.5.0 (2023-08-24)

### Features

* prepare release pipeline ([#1](https://github.com/wundergraph/cosmo/issues/1)) ([747aa47](https://github.com/wundergraph/cosmo/commit/747aa47d5e965d1b74862fbb5598bafb2fa05ee2)) (@StarpTech)

## [0.4.2](https://github.com/wundergraph/cosmo/compare/controlplane@0.3.0...controlplane@0.4.2) (2023-08-24)

**Note:** Version bump only for package controlplane

## [0.4.1](https://github.com/wundergraph/cosmo/compare/controlplane@0.3.0...controlplane@0.4.1) (2023-08-24)

**Note:** Version bump only for package controlplane

# 0.4.0 (2023-08-24)

### Features

* prepare release pipeline ([#1](https://github.com/wundergraph/cosmo/issues/1)) ([747aa47](https://github.com/wundergraph/cosmo/commit/747aa47d5e965d1b74862fbb5598bafb2fa05ee2)) (@StarpTech)

# 0.3.0 (2023-08-24)

### Features

* prepare release pipeline ([#1](https://github.com/wundergraph/cosmo/issues/1)) ([747aa47](https://github.com/wundergraph/cosmo/commit/747aa47d5e965d1b74862fbb5598bafb2fa05ee2)) (@StarpTech)

# 0.2.0 (2023-08-24)

### Features

* prepare release pipeline ([#1](https://github.com/wundergraph/cosmo/issues/1)) ([747aa47](https://github.com/wundergraph/cosmo/commit/747aa47d5e965d1b74862fbb5598bafb2fa05ee2)) (@StarpTech)

# 0.1.0 (2023-08-24)

### Features

* prepare release pipeline ([#1](https://github.com/wundergraph/cosmo/issues/1)) ([747aa47](https://github.com/wundergraph/cosmo/commit/747aa47d5e965d1b74862fbb5598bafb2fa05ee2)) (@StarpTech)

# 0.1.0 (2023-08-24)

### Features

* prepare release pipeline ([#1](https://github.com/wundergraph/cosmo/issues/1)) ([747aa47](https://github.com/wundergraph/cosmo/commit/747aa47d5e965d1b74862fbb5598bafb2fa05ee2)) (@StarpTech)
