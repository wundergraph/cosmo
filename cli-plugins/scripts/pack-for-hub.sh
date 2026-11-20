#!/usr/bin/env bash
# Builds wgc and the plugin packages and packs them as tarballs with stable names, for a server
# that hosts them under one base URL, e.g. https://<hub>/cli:
#
#   npm i -g --allow-remote=all https://<hub>/cli/wgc.tgz
#   WGC_PLUGIN_REGISTRY_URL=https://<hub>/cli wgc plugins install hub
#
# wgc.tgz bundles the plugin SDK. The plugins resolve it from wgc-plugin-sdk.tgz at the same URL.
# The packages wgc depends on from this repository (composition, connect, shared, protographic) must
# already be built; their published versions are what the tarballs depend on.
#
# Usage: cli-plugins/scripts/pack-for-hub.sh [output-dir]   (default: cli-plugins/.hub-pack)
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
output_dir="$(mkdir -p "${1:-$repo_root/cli-plugins/.hub-pack}" && cd "${1:-$repo_root/cli-plugins/.hub-pack}" && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

build_package() {
  local filter="$1"

  echo "Building $filter" >&2
  pnpm --dir "$repo_root" --filter "$filter" run build >&2
}

# pnpm pack turns workspace: and catalog: ranges into the versions they resolve to.
pack_package() {
  local package_dir="$1"
  local tarball_name="$2"
  local destination="$work_dir/$tarball_name"

  mkdir -p "$destination"
  (cd "$repo_root/$package_dir" && pnpm pack --pack-destination "$destination" >&2)
  mv "$destination"/*.tgz "$output_dir/$tarball_name.tgz"
  echo "Packed $output_dir/$tarball_name.tgz" >&2
}

# npm takes a bundled dependency and everything it depends on from inside the tarball, so wgc.tgz
# carries the SDK with its own dependencies and needs no registry for it.
bundle_sdk_into_wgc() {
  local unpacked="$work_dir/wgc-unpacked"
  local sdk_project="$work_dir/sdk-project"

  mkdir -p "$unpacked" "$sdk_project"
  tar -xzf "$output_dir/wgc.tgz" -C "$unpacked"

  echo '{ "name": "sdk-project", "private": true }' > "$sdk_project/package.json"
  (cd "$sdk_project" && npm install --no-audit --no-fund --ignore-scripts --omit=dev "$output_dir/wgc-plugin-sdk.tgz" >&2)
  cp -R "$sdk_project/node_modules" "$unpacked/package/node_modules"
  rm -f "$unpacked/package/node_modules/.package-lock.json"

  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
    manifest.bundleDependencies = ["@wundergraph/wgc-plugin-sdk"];
    fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  ' "$unpacked/package/package.json"

  mkdir -p "$work_dir/wgc-bundled"
  (cd "$unpacked/package" && npm pack --pack-destination "$work_dir/wgc-bundled" >&2)
  mv "$work_dir/wgc-bundled"/*.tgz "$output_dir/wgc.tgz"
  echo "Bundled the plugin SDK into $output_dir/wgc.tgz" >&2
}

build_package @wundergraph/wgc-plugin-sdk
build_package @wundergraph/wgc-plugin-hub
build_package @wundergraph/wgc-plugin-forge
build_package wgc

pack_package cli-plugins/sdk wgc-plugin-sdk
pack_package cli-plugins/hub wgc-plugin-hub
pack_package cli-plugins/forge wgc-plugin-forge
pack_package cli wgc
bundle_sdk_into_wgc

ls -1 "$output_dir"/*.tgz
