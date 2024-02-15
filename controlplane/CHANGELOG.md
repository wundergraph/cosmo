# Change Log
Binaries are attached to the github release otherwise all images can be found [here](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
