# Change Log
Binaries are attached to the github release otherwise all images can be found [here](https://github.com/orgs/wundergraph/packages?repo_name=cosmo)

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.23.1](https://github.com/wundergraph/cosmo/compare/studio@0.23.0...studio@0.23.1) (2023-10-11)

### Bug Fixes

* migration and add logs on error ([#171](https://github.com/wundergraph/cosmo/issues/171)) ([ea14203](https://github.com/wundergraph/cosmo/commit/ea14203f392d90d98c1d2f61374de9093842b5cb)) (@JivusAyrus)

# [0.23.0](https://github.com/wundergraph/cosmo/compare/studio@0.22.0...studio@0.23.0) (2023-10-09)

### Bug Fixes

* ui improvements ([#170](https://github.com/wundergraph/cosmo/issues/170)) ([fffd3e2](https://github.com/wundergraph/cosmo/commit/fffd3e2b7d9a82e7b809214a7ce836cce83f54b9)) (@thisisnithin)

### Features

* use metric data for dashboard stats ([#169](https://github.com/wundergraph/cosmo/issues/169)) ([e25fe32](https://github.com/wundergraph/cosmo/commit/e25fe32cdc053d658b0b0cdcd819b039be3341e6)) (@StarpTech)

# [0.22.0](https://github.com/wundergraph/cosmo/compare/studio@0.21.0...studio@0.22.0) (2023-10-06)

### Features

* display router initiation command ([#158](https://github.com/wundergraph/cosmo/issues/158)) ([284200b](https://github.com/wundergraph/cosmo/commit/284200b5ebae35a348fef1a650d268800f3887ac)) (@JivusAyrus)
* use clickhouse as metric storage ([#137](https://github.com/wundergraph/cosmo/issues/137)) ([c5e9bf4](https://github.com/wundergraph/cosmo/commit/c5e9bf4b74d32f3cae7da27b6170300c1a462e52)) (@StarpTech)

# [0.21.0](https://github.com/wundergraph/cosmo/compare/studio@0.20.0...studio@0.21.0) (2023-10-05)

### Bug Fixes

* sdl viewer overflow ([#148](https://github.com/wundergraph/cosmo/issues/148)) ([bf1b8e8](https://github.com/wundergraph/cosmo/commit/bf1b8e8f9435f90ee152bcb4c1780a854f4a96c7)) (@thisisnithin)

### Features

* configurable webhook events ([#149](https://github.com/wundergraph/cosmo/issues/149)) ([54836cc](https://github.com/wundergraph/cosmo/commit/54836cc5cb5a4fb46817ec04e82bfafaa134d59c)) (@thisisnithin)

# [0.20.0](https://github.com/wundergraph/cosmo/compare/studio@0.19.0...studio@0.20.0) (2023-10-04)

### Bug Fixes

* flickering issue on change of orgs ([#147](https://github.com/wundergraph/cosmo/issues/147)) ([eadbb77](https://github.com/wundergraph/cosmo/commit/eadbb775e63cd10488c21079fed14e59771249c7)) (@JivusAyrus)

### Features

* github app integration ([#140](https://github.com/wundergraph/cosmo/issues/140)) ([783a1f9](https://github.com/wundergraph/cosmo/commit/783a1f9c3f42284d1bf6cfa0d8fd46971724500a)) (@thisisnithin)

# [0.19.0](https://github.com/wundergraph/cosmo/compare/studio@0.18.1...studio@0.19.0) (2023-09-29)

### Features

* implement leave and delete organization ([#112](https://github.com/wundergraph/cosmo/issues/112)) ([59bc44f](https://github.com/wundergraph/cosmo/commit/59bc44f53cbc72d492cf0e07e75d7e62e7c68b61)) (@JivusAyrus)
* improve trail version banner and handle trial version expiry ([#138](https://github.com/wundergraph/cosmo/issues/138)) ([0ecb2d1](https://github.com/wundergraph/cosmo/commit/0ecb2d150d9f9906631168aa0f588d2ca64ab590)) (@JivusAyrus)

## [0.18.1](https://github.com/wundergraph/cosmo/compare/studio@0.18.0...studio@0.18.1) (2023-09-28)

### Bug Fixes

* fixed issue where tracing elements would render on top of the page header ([#134](https://github.com/wundergraph/cosmo/issues/134)) ([da4379e](https://github.com/wundergraph/cosmo/commit/da4379e9692f81780faff72695360964d84506e3)) (@Pagebakers)
* use correct range for error rate queries ([#133](https://github.com/wundergraph/cosmo/issues/133)) ([ff0b004](https://github.com/wundergraph/cosmo/commit/ff0b004fd6cf4f08540f76c858ea6dfaebcdd70e)) (@Pagebakers)

# [0.18.0](https://github.com/wundergraph/cosmo/compare/studio@0.17.1...studio@0.18.0) (2023-09-27)

### Features

* add 1 and 4 hour ranges, refresh button and minor improvements ([#128](https://github.com/wundergraph/cosmo/issues/128)) ([f5cbfc7](https://github.com/wundergraph/cosmo/commit/f5cbfc79f23d0a1bbbbb1a910d82ff5894a0240d)) (@Pagebakers)

## [0.17.1](https://github.com/wundergraph/cosmo/compare/studio@0.17.0...studio@0.17.1) (2023-09-27)

### Bug Fixes

* click on analaytics row menu opens trace view ([#125](https://github.com/wundergraph/cosmo/issues/125)) ([2740207](https://github.com/wundergraph/cosmo/commit/2740207004eb52e53710a349d94c49aac0952c2a)) (@thisisnithin)
* fixed issue where expired session would cause redirect loop ([#127](https://github.com/wundergraph/cosmo/issues/127)) ([618de74](https://github.com/wundergraph/cosmo/commit/618de74934b27a704124186ff41341727e284553)) (@Pagebakers)

# [0.17.0](https://github.com/wundergraph/cosmo/compare/studio@0.16.0...studio@0.17.0) (2023-09-27)

### Features

* support being a part of multiple organizations ([#119](https://github.com/wundergraph/cosmo/issues/119)) ([338e336](https://github.com/wundergraph/cosmo/commit/338e336a75435e150c8acfb01b88a8a086f7000a)) (@JivusAyrus)

# [0.16.0](https://github.com/wundergraph/cosmo/compare/studio@0.15.2...studio@0.16.0) (2023-09-25)

### Features

* implement get changelog cli command ([#117](https://github.com/wundergraph/cosmo/issues/117)) ([ffaad09](https://github.com/wundergraph/cosmo/commit/ffaad093a212a6340263c4223452fb9edfec7570)) (@thisisnithin)

## [0.15.2](https://github.com/wundergraph/cosmo/compare/studio@0.15.1...studio@0.15.2) (2023-09-25)

### Bug Fixes

* improved analytics queries and output ([#115](https://github.com/wundergraph/cosmo/issues/115)) ([c0d4b9d](https://github.com/wundergraph/cosmo/commit/c0d4b9d2392aac205d6671e1c8c418de8eb40cf4)) (@Pagebakers)

## [0.15.1](https://github.com/wundergraph/cosmo/compare/studio@0.15.0...studio@0.15.1) (2023-09-25)

### Bug Fixes

* metrics repository and ui ([#113](https://github.com/wundergraph/cosmo/issues/113)) ([549ac6c](https://github.com/wundergraph/cosmo/commit/549ac6cd88e148ed9924d427ca306eb832cdd2ec)) (@thisisnithin)

# [0.15.0](https://github.com/wundergraph/cosmo/compare/studio@0.14.0...studio@0.15.0) (2023-09-25)

### Features

* advanced analytics ([#99](https://github.com/wundergraph/cosmo/issues/99)) ([a7a3058](https://github.com/wundergraph/cosmo/commit/a7a305851faa868d30dc202eef197afc6065ce92)) (@Pagebakers)

# [0.14.0](https://github.com/wundergraph/cosmo/compare/studio@0.13.1...studio@0.14.0) (2023-09-21)

### Features

* changelog pagination ([#103](https://github.com/wundergraph/cosmo/issues/103)) ([614b57e](https://github.com/wundergraph/cosmo/commit/614b57ed4904dde04682e75ad80670f08f64b7b2)) (@thisisnithin)

## [0.13.1](https://github.com/wundergraph/cosmo/compare/studio@0.13.0...studio@0.13.1) (2023-09-20)

### Bug Fixes

* improve session redirect ([#96](https://github.com/wundergraph/cosmo/issues/96)) ([5ff36ce](https://github.com/wundergraph/cosmo/commit/5ff36ce7ee9892a8d70a4ecb4052ac0f5548c127)) (@Pagebakers)

# [0.13.0](https://github.com/wundergraph/cosmo/compare/studio@0.12.1...studio@0.13.0) (2023-09-20)

### Features

* store subgraphs in router config ([#61](https://github.com/wundergraph/cosmo/issues/61)) ([de7b132](https://github.com/wundergraph/cosmo/commit/de7b13244755acd49c38ff1e6c537234ab506960)) (@thisisnithin)

## [0.12.1](https://github.com/wundergraph/cosmo/compare/studio@0.12.0...studio@0.12.1) (2023-09-19)

### Bug Fixes

* only redirect to login when user is actually logged out ([#89](https://github.com/wundergraph/cosmo/issues/89)) ([ff4b3df](https://github.com/wundergraph/cosmo/commit/ff4b3df18f91179a83e47ec5f48157bc3a0ee9fb)) (@Pagebakers)

# [0.12.0](https://github.com/wundergraph/cosmo/compare/studio@0.11.1...studio@0.12.0) (2023-09-16)

### Features

* only generate node api for router ([#76](https://github.com/wundergraph/cosmo/issues/76)) ([9307648](https://github.com/wundergraph/cosmo/commit/93076481437030fa6e348dccbc74591f91878f57)) (@StarpTech)
* webhooks ([#66](https://github.com/wundergraph/cosmo/issues/66)) ([dbb281f](https://github.com/wundergraph/cosmo/commit/dbb281fda114ddb6be309b3336d0668d705e7bc9)) (@thisisnithin)

## [0.11.1](https://github.com/wundergraph/cosmo/compare/studio@0.11.0...studio@0.11.1) (2023-09-14)

### Bug Fixes

* router docs dialog ([#63](https://github.com/wundergraph/cosmo/issues/63)) ([fbedd8b](https://github.com/wundergraph/cosmo/commit/fbedd8bdb16070ae0bdc013c738ec3d70ac56327)) (@JivusAyrus)

# [0.11.0](https://github.com/wundergraph/cosmo/compare/studio@0.10.2...studio@0.11.0) (2023-09-13)

### Features

* add user registration ([#57](https://github.com/wundergraph/cosmo/issues/57)) ([c1d1841](https://github.com/wundergraph/cosmo/commit/c1d184192511f015c4b33db91d7342a0bb35710e)) (@JivusAyrus)

## [0.10.2](https://github.com/wundergraph/cosmo/compare/studio@0.10.1...studio@0.10.2) (2023-09-11)

### Bug Fixes

* changelog date overflow ([#52](https://github.com/wundergraph/cosmo/issues/52)) ([27b23fb](https://github.com/wundergraph/cosmo/commit/27b23fbae994cd34116c4318596807cc25aed80f)) (@thisisnithin)

## [0.10.1](https://github.com/wundergraph/cosmo/compare/studio@0.10.0...studio@0.10.1) (2023-09-06)

### Bug Fixes

* take variant name as input while migrating ([#40](https://github.com/wundergraph/cosmo/issues/40)) ([6ace9fc](https://github.com/wundergraph/cosmo/commit/6ace9fc93c246dce3fce641a2e274e93d99ae813)) (@JivusAyrus)

# [0.10.0](https://github.com/wundergraph/cosmo/compare/studio@0.9.0...studio@0.10.0) (2023-09-06)

### Features

* add argument configuration ([#10](https://github.com/wundergraph/cosmo/issues/10)) ([48d909f](https://github.com/wundergraph/cosmo/commit/48d909f4de954c2401b557ed6a9f58915388f679)) (@Aenimus)
* add pagination and date range filter for schema checks ([#35](https://github.com/wundergraph/cosmo/issues/35)) ([e7bbc04](https://github.com/wundergraph/cosmo/commit/e7bbc04f76180cfe4210f173697f323b34650e41)) (@JivusAyrus)
* move to new connectrpc packages ([#32](https://github.com/wundergraph/cosmo/issues/32)) ([4c8423b](https://github.com/wundergraph/cosmo/commit/4c8423bf377b63af6a42a42d7d5fc1ce2db1f09e)) (@StarpTech)

# [0.9.0](https://github.com/wundergraph/cosmo/compare/studio@0.8.0...studio@0.9.0) (2023-09-02)

### Bug Fixes

* update the docs url ([#30](https://github.com/wundergraph/cosmo/issues/30)) ([e9c498f](https://github.com/wundergraph/cosmo/commit/e9c498faf93a289f2eb62c7203f6a9fe79e7a93a)) (@JivusAyrus)

### Features

* add prometheus ([#31](https://github.com/wundergraph/cosmo/issues/31)) ([d318c73](https://github.com/wundergraph/cosmo/commit/d318c7331d77d21d0246344d76fbe0fc6b617174)) (@StarpTech)

# [0.8.0](https://github.com/wundergraph/cosmo/compare/studio@0.7.2...studio@0.8.0) (2023-08-31)

### Bug Fixes

* improvements ([#25](https://github.com/wundergraph/cosmo/issues/25)) ([5afa6bc](https://github.com/wundergraph/cosmo/commit/5afa6bc0fb89907646212c0449595481e1c8b46d)) (@JivusAyrus)
* improvements ([#27](https://github.com/wundergraph/cosmo/issues/27)) ([884635f](https://github.com/wundergraph/cosmo/commit/884635f7902f97156e9cdd0cf52d29027509a52e)) (@JivusAyrus)

### Features

* migrate graphs from apollo ([#17](https://github.com/wundergraph/cosmo/issues/17)) ([0d9d025](https://github.com/wundergraph/cosmo/commit/0d9d025adadf11fd0516cbe10f470765757a9853)) (@JivusAyrus)

## [0.7.2](https://github.com/wundergraph/cosmo/compare/studio@0.7.1...studio@0.7.2) (2023-08-29)

### Bug Fixes

* ci ([#20](https://github.com/wundergraph/cosmo/issues/20)) ([e676b1a](https://github.com/wundergraph/cosmo/commit/e676b1a6dfeaa1ff8b6d55f818ae301f49deea4c)) (@JivusAyrus)

## [0.7.1](https://github.com/wundergraph/cosmo/compare/studio@0.7.0...studio@0.7.1) (2023-08-29)

### Bug Fixes

* improvements ([#18](https://github.com/wundergraph/cosmo/issues/18)) ([fdf2b29](https://github.com/wundergraph/cosmo/commit/fdf2b290ec57e502d8011e29e06a067d32afdf18)) (@JivusAyrus)

# [0.7.0](https://github.com/wundergraph/cosmo/compare/studio@0.6.0...studio@0.7.0) (2023-08-28)

### Bug Fixes

* api keys modal ([#8](https://github.com/wundergraph/cosmo/issues/8)) ([80a6e05](https://github.com/wundergraph/cosmo/commit/80a6e053f0699fc302e92e41738219fbba38ad9b)) (@JivusAyrus)
* ui ([#4](https://github.com/wundergraph/cosmo/issues/4)) ([2be4987](https://github.com/wundergraph/cosmo/commit/2be4987d8707be3c2b42d72f12e8db0b91b525b2)) (@JivusAyrus)

### Features

* add resend invitation and remove member/invitation functionality ([#2](https://github.com/wundergraph/cosmo/issues/2)) ([7528ba3](https://github.com/wundergraph/cosmo/commit/7528ba3f6456be40769ea314b3b36a26a10e852b)) (@JivusAyrus)

# 0.6.0 (2023-08-24)

### Features

* prepare release pipeline ([#1](https://github.com/wundergraph/cosmo/issues/1)) ([747aa47](https://github.com/wundergraph/cosmo/commit/747aa47d5e965d1b74862fbb5598bafb2fa05ee2)) (@StarpTech)

# 0.5.0 (2023-08-24)

### Features

* prepare release pipeline ([#1](https://github.com/wundergraph/cosmo/issues/1)) ([747aa47](https://github.com/wundergraph/cosmo/commit/747aa47d5e965d1b74862fbb5598bafb2fa05ee2)) (@)

## [0.4.1](https://github.com/wundergraph/cosmo/compare/cosmo-studio@0.3.0...cosmo-studio@0.4.1) (2023-08-24)

**Note:** Version bump only for package cosmo-studio

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
