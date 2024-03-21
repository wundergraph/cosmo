# Change Log
Binaries are attached to the github release otherwise all images can be found [here](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.7.2](https://github.com/wundergraph/cosmo/compare/cdn@0.7.1...cdn@0.7.2) (2024-03-21)

### Bug Fixes

* **cdn:** shutdown gracefully ([#657](https://github.com/wundergraph/cosmo/issues/657)) ([bcb056f](https://github.com/wundergraph/cosmo/commit/bcb056fdb4964b5d296774bac5fa0ef1adc66454)) (@StarpTech)

## [0.7.1](https://github.com/wundergraph/cosmo/compare/cdn@0.7.0...cdn@0.7.1) (2024-03-16)

**Note:** Version bump only for package cdn

# [0.7.0](https://github.com/wundergraph/cosmo/compare/cdn@0.6.0...cdn@0.7.0) (2024-03-14)

### Features

* router config signature validation through custom admission webhooks ([#628](https://github.com/wundergraph/cosmo/issues/628)) ([384fd7e](https://github.com/wundergraph/cosmo/commit/384fd7e3372479e96fccc4fc771dc4e9f9c84754)) (@StarpTech)

# [0.6.0](https://github.com/wundergraph/cosmo/compare/cdn@0.5.0...cdn@0.6.0) (2024-02-08)

### Features

* upgrade to active lts node images ([#501](https://github.com/wundergraph/cosmo/issues/501)) ([684f89f](https://github.com/wundergraph/cosmo/commit/684f89f8b6c46a3b24117c221cab41a5b60dd534)) (@StarpTech)

# [0.5.0](https://github.com/wundergraph/cosmo/compare/cdn@0.4.2...cdn@0.5.0) (2024-02-01)

### Features

* integrate S3 when executing "getLatestValidRouterConfig" from the CLI ([#467](https://github.com/wundergraph/cosmo/issues/467)) ([90b7c8e](https://github.com/wundergraph/cosmo/commit/90b7c8ed01bdd659183c87cc2d94946ab20fe073)) (@JivusAyrus)

## [0.4.2](https://github.com/wundergraph/cosmo/compare/cdn@0.4.1...cdn@0.4.2) (2024-01-21)

**Note:** Version bump only for package cdn

## [0.4.1](https://github.com/wundergraph/cosmo/compare/cdn@0.4.0...cdn@0.4.1) (2024-01-12)

### Bug Fixes

* pass context for r2 ([#416](https://github.com/wundergraph/cosmo/issues/416)) ([b34b2db](https://github.com/wundergraph/cosmo/commit/b34b2dbac8d9bd57b5b8bb9405a20055fc22f856)) (@JivusAyrus)

# [0.4.0](https://github.com/wundergraph/cosmo/compare/cdn@0.3.2...cdn@0.4.0) (2024-01-12)

### Bug Fixes

* **cdn:** return 404 when config does not exist ([#415](https://github.com/wundergraph/cosmo/issues/415)) ([63af53b](https://github.com/wundergraph/cosmo/commit/63af53b58ea9f3f77ffaf59847ba62d48e9a03fc)) (@StarpTech)

### Features

* provide router config over cdn ([#411](https://github.com/wundergraph/cosmo/issues/411)) ([f04ac84](https://github.com/wundergraph/cosmo/commit/f04ac84d2f6c155409f7db69e7646c04047e32b5)) (@JivusAyrus)

## [0.3.2](https://github.com/wundergraph/cosmo/compare/cdn@0.3.1...cdn@0.3.2) (2023-11-30)

### Bug Fixes

* image releases ([230fcef](https://github.com/wundergraph/cosmo/commit/230fcef52db8c36dd54ee8b5568eb627811d4fb1)) (@StarpTech)

## [0.3.1](https://github.com/wundergraph/cosmo/compare/cdn@0.2.0...cdn@0.3.1) (2023-11-30)

### Bug Fixes

* change cdn-server package name ([8b00be6](https://github.com/wundergraph/cosmo/commit/8b00be672032a74c16b914fc5f6d09590b1beff7)) (@StarpTech)
* change cdn-server to cdn ([3b6092f](https://github.com/wundergraph/cosmo/commit/3b6092f9926d92925fd907f6c6b787247b6831b8)) (@StarpTech)

# 0.3.0 (2023-11-30)

### Bug Fixes

* add typescript to cdn deps ([#300](https://github.com/wundergraph/cosmo/issues/300)) ([1f4e6c7](https://github.com/wundergraph/cosmo/commit/1f4e6c70ef52013dc309d1d0b914a7300dcbbeca)) (@)
* declare cosmo-cdn package as public ([#288](https://github.com/wundergraph/cosmo/issues/288)) ([950d5f0](https://github.com/wundergraph/cosmo/commit/950d5f07578a4f12a24077763db63834f878774d)) (@)

### Features

* accept custom operation IDs for persisted operations ([#302](https://github.com/wundergraph/cosmo/issues/302)) ([a535a62](https://github.com/wundergraph/cosmo/commit/a535a62bb7f70d2e58d1a04066fb74e78d932653)) (@)
* add helm chart for CDN ([#307](https://github.com/wundergraph/cosmo/issues/307)) ([5e70d88](https://github.com/wundergraph/cosmo/commit/5e70d8834d2a676caee691a344ff1beb01689002)) (@)
* add support for persisted operations ([#249](https://github.com/wundergraph/cosmo/issues/249)) ([a9ad47f](https://github.com/wundergraph/cosmo/commit/a9ad47ff5cf7db6bccf774e168b1d1ce3ee7bcdd)) (@)

# 0.2.0 (2023-11-30)

### Bug Fixes

* add typescript to cdn deps ([#300](https://github.com/wundergraph/cosmo/issues/300)) ([1f4e6c7](https://github.com/wundergraph/cosmo/commit/1f4e6c70ef52013dc309d1d0b914a7300dcbbeca)) (@)
* declare cosmo-cdn package as public ([#288](https://github.com/wundergraph/cosmo/issues/288)) ([950d5f0](https://github.com/wundergraph/cosmo/commit/950d5f07578a4f12a24077763db63834f878774d)) (@)

### Features

* accept custom operation IDs for persisted operations ([#302](https://github.com/wundergraph/cosmo/issues/302)) ([a535a62](https://github.com/wundergraph/cosmo/commit/a535a62bb7f70d2e58d1a04066fb74e78d932653)) (@)
* add helm chart for CDN ([#307](https://github.com/wundergraph/cosmo/issues/307)) ([5e70d88](https://github.com/wundergraph/cosmo/commit/5e70d8834d2a676caee691a344ff1beb01689002)) (@fiam)
* add support for persisted operations ([#249](https://github.com/wundergraph/cosmo/issues/249)) ([a9ad47f](https://github.com/wundergraph/cosmo/commit/a9ad47ff5cf7db6bccf774e168b1d1ce3ee7bcdd)) (@)
