# Change Log
Binaries are attached to the github release otherwise all images can be found [here](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.12.2](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.12.1...@wundergraph/composition@0.12.2) (2023-12-14)

### Bug Fixes

* accept specifiedBy directive ([#367](https://github.com/wundergraph/cosmo/issues/367)) ([49926da](https://github.com/wundergraph/cosmo/commit/49926daa7f9d17434f2b42893ec6a8b613e5731e)) (@Aenimus)

## [0.12.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.12.0...@wundergraph/composition@0.12.1) (2023-12-13)

### Bug Fixes

* if a type has already been overridden, add the new field names t… ([#363](https://github.com/wundergraph/cosmo/issues/363)) ([fd0110d](https://github.com/wundergraph/cosmo/commit/fd0110d0069ff27a51a442ad8dc4133351f894af)) (@Aenimus)
* return error if override source and target are equivalent ([#362](https://github.com/wundergraph/cosmo/issues/362)) ([e12e4fa](https://github.com/wundergraph/cosmo/commit/e12e4fad0e9d7415e62d7ddbfb0fbafb9025251c)) (@Aenimus)

# [0.12.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.11.3...@wundergraph/composition@0.12.0) (2023-12-12)

### Features

* implement foundations for entity interfaces ([#359](https://github.com/wundergraph/cosmo/issues/359)) ([e2fcec7](https://github.com/wundergraph/cosmo/commit/e2fcec7aa3f286159a1ad21d606ead41cf1c883e)) (@Aenimus)

## [0.11.3](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.11.2...@wundergraph/composition@0.11.3) (2023-11-29)

**Note:** Version bump only for package @wundergraph/composition

## [0.11.2](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.11.1...@wundergraph/composition@0.11.2) (2023-11-29)

### Bug Fixes

* fixed bug in path finding logic ([#312](https://github.com/wundergraph/cosmo/issues/312)) ([14ae242](https://github.com/wundergraph/cosmo/commit/14ae24268cca5418f0b049aba946cf71c4a391bc)) (@Aenimus)
* handle missing query root type without fields ([#311](https://github.com/wundergraph/cosmo/issues/311)) ([6334fac](https://github.com/wundergraph/cosmo/commit/6334facd66a925fa07e8444570031b644979e9a3)) (@Aenimus)

## [0.11.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.11.0...@wundergraph/composition@0.11.1) (2023-11-28)

### Bug Fixes

* remove federation fields from renamed root types ([#304](https://github.com/wundergraph/cosmo/issues/304)) ([659cbaf](https://github.com/wundergraph/cosmo/commit/659cbaf9647075a16f3d00fb7c0ae2239a0174b7)) (@Aenimus)

# [0.11.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.10.1...@wundergraph/composition@0.11.0) (2023-11-10)

### Features

* implement [@override](https://github.com/override) ([#246](https://github.com/wundergraph/cosmo/issues/246)) ([b6d0448](https://github.com/wundergraph/cosmo/commit/b6d044861e918f7c82931e1d5374fc7f6fc01daa)) (@Aenimus)

## [0.10.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.10.0...@wundergraph/composition@0.10.1) (2023-10-26)

**Note:** Version bump only for package @wundergraph/composition

# [0.10.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.9.0...@wundergraph/composition@0.10.0) (2023-10-09)

### Features

* use metric data for dashboard stats ([#169](https://github.com/wundergraph/cosmo/issues/169)) ([e25fe32](https://github.com/wundergraph/cosmo/commit/e25fe32cdc053d658b0b0cdcd819b039be3341e6)) (@StarpTech)

# [0.9.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.8.1...@wundergraph/composition@0.9.0) (2023-09-26)

### Features

* allow arguments in [@requires](https://github.com/requires) and [@provides](https://github.com/provides) ([#122](https://github.com/wundergraph/cosmo/issues/122)) ([2925f23](https://github.com/wundergraph/cosmo/commit/2925f23ba70dda5485f33c6950e979d956f46775)) (@Aenimus)

## [0.8.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.8.0...@wundergraph/composition@0.8.1) (2023-09-20)

### Bug Fixes

* composition false flag ([#97](https://github.com/wundergraph/cosmo/issues/97)) ([a25cc7f](https://github.com/wundergraph/cosmo/commit/a25cc7f13adbf6f8e29113f49d364fc1f8bb9e81)) (@Aenimus)

# [0.8.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.7.1...@wundergraph/composition@0.8.0) (2023-09-19)

### Features

* account for extension field arguments ([#94](https://github.com/wundergraph/cosmo/issues/94)) ([3ae8cbe](https://github.com/wundergraph/cosmo/commit/3ae8cbef79e9b5de9140f201cb867d05b9da7d31)) (@Aenimus)

## [0.7.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.7.0...@wundergraph/composition@0.7.1) (2023-09-18)

### Bug Fixes

* consider nested entity keys to be shareable ([#86](https://github.com/wundergraph/cosmo/issues/86)) ([98b68a1](https://github.com/wundergraph/cosmo/commit/98b68a1bcbd40fc2c5ec0b9866218b6854cf95ee)) (@Aenimus)

# [0.7.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.6.2...@wundergraph/composition@0.7.0) (2023-09-15)

### Features

* refactor FieldSet ([#71](https://github.com/wundergraph/cosmo/issues/71)) ([45224d6](https://github.com/wundergraph/cosmo/commit/45224d6b6a2d5a2689fd034947a1acd69572e9c6)) (@Aenimus)

## [0.6.2](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.6.1...@wundergraph/composition@0.6.2) (2023-09-11)

**Note:** Version bump only for package @wundergraph/composition

## [0.6.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.6.0...@wundergraph/composition@0.6.1) (2023-09-08)

### Bug Fixes

* fix migration issues ([#47](https://github.com/wundergraph/cosmo/issues/47)) ([048398a](https://github.com/wundergraph/cosmo/commit/048398a3b5c4effaa1d7f6387c4ca02fbd28700c)) (@Aenimus)

# [0.6.0](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.5.3...@wundergraph/composition@0.6.0) (2023-09-06)

### Features

* add argument configuration ([#10](https://github.com/wundergraph/cosmo/issues/10)) ([48d909f](https://github.com/wundergraph/cosmo/commit/48d909f4de954c2401b557ed6a9f58915388f679)) (@Aenimus)
* move to new connectrpc packages ([#32](https://github.com/wundergraph/cosmo/issues/32)) ([4c8423b](https://github.com/wundergraph/cosmo/commit/4c8423bf377b63af6a42a42d7d5fc1ce2db1f09e)) (@StarpTech)

## [0.5.3](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.5.2...@wundergraph/composition@0.5.3) (2023-08-31)

### Bug Fixes

* add caching for multigraph node paths ([#29](https://github.com/wundergraph/cosmo/issues/29)) ([106810b](https://github.com/wundergraph/cosmo/commit/106810b4f24118a707d1798c20d1c7e8975c9a8e)) (@Aenimus)

## [0.5.2](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.5.1...@wundergraph/composition@0.5.2) (2023-08-29)

### Bug Fixes

* do not include _Service and _entities in the federated graph ([#19](https://github.com/wundergraph/cosmo/issues/19)) ([97201ed](https://github.com/wundergraph/cosmo/commit/97201ed337205d96e55d1524e471a9116d93a389)) (@JivusAyrus)

## [0.5.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.5.0...@wundergraph/composition@0.5.1) (2023-08-28)

**Note:** Version bump only for package @wundergraph/composition

# 0.5.0 (2023-08-24)

### Features

* prepare release pipeline ([#1](https://github.com/wundergraph/cosmo/issues/1)) ([747aa47](https://github.com/wundergraph/cosmo/commit/747aa47d5e965d1b74862fbb5598bafb2fa05ee2)) (@StarpTech)

## [0.4.2](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.3.0...@wundergraph/composition@0.4.2) (2023-08-24)

**Note:** Version bump only for package @wundergraph/composition

## [0.4.1](https://github.com/wundergraph/cosmo/compare/@wundergraph/composition@0.3.0...@wundergraph/composition@0.4.1) (2023-08-24)

**Note:** Version bump only for package @wundergraph/composition

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
