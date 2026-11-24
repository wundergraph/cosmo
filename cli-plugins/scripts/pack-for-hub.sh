#!/usr/bin/env bash
# Builds wgc and the plugin packages and packs them as tarballs with stable names for one Hub
# deployment, which serves them under https://<hub>/cli:
#
#   npm i -g --allow-remote=all https://<hub>/cli/wgc.tgz
#   wgcm plugins install hub
#
# wgc.tgz is the npm package @wundergraph/wgcm with the single command wgcm, so it installs next to
# a global wgc without replacing it. wgcm keeps its login, plugins and caches under
# $XDG_CONFIG_HOME/wgcm (default ~/.config/wgcm) and WGC_PLUGINS_DIR still moves the plugins.
# The packed wgcm has the deployment's hosts baked in and installs plugins from the same URL, so it
# needs no environment variables; they still override the baked hosts. BASE_DOMAIN names the
# deployment: cosmo.<base> is the control plane, studio.<base> Studio, hub.<base> Hub's API, web app
# and Keycloak, cdn.<base> the CDN. BASE_DOMAIN=localhost is the local install on its fixed ports,
# with Hub's API on 4405 and its web app on 4400; hubDeployment in cli/src/core/deployment.ts holds
# both sets of hosts. A Hub deployment's wgc sends telemetry only with COSMO_TELEMETRY_ENABLED=true
# and does not check npm for updates. The pack fails when a tarball still names a WunderGraph
# production host.
#
# wgc.tgz bundles the plugin SDK. The plugins resolve it from wgc-plugin-sdk.tgz at the same URL.
# The packages wgc depends on from this repository (composition, connect, shared, protographic) must
# already be built; their published versions are what the tarballs depend on.
#
# Usage: BASE_DOMAIN=<domain> cli-plugins/scripts/pack-for-hub.sh [output-dir]   (default: cli-plugins/.hub-pack)
set -euo pipefail

if [[ -z "${BASE_DOMAIN:-}" ]]; then
  echo "Set BASE_DOMAIN to the Hub deployment the tarballs are for, e.g. BASE_DOMAIN=moonshot.wundergraph.com, or BASE_DOMAIN=localhost for the local install. Without it wgc talks to Cosmo Cloud." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
output_dir="$(mkdir -p "${1:-$repo_root/cli-plugins/.hub-pack}" && cd "${1:-$repo_root/cli-plugins/.hub-pack}" && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

build_package() {
  local filter="$1"

  echo "Building $filter" >&2
  pnpm --dir "$repo_root" --filter "$filter..." run build >&2
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

# Replaces the compiled cli/src/core/deployment.ts with the hosts hubDeployment gives for BASE_DOMAIN.
bake_deployment() {
  local module="$1/dist/src/core/deployment.js"

  if [[ ! -f "$module" ]]; then
    echo "$module is missing; cli/src/core/deployment.ts must compile to it." >&2
    exit 1
  fi

  node --input-type=module -e '
    import { writeFileSync } from "node:fs";
    import { pathToFileURL } from "node:url";
    const [module, baseDomain] = process.argv.slice(1);
    const { hubDeployment } = await import(pathToFileURL(module).href);
    writeFileSync(module, `export const deployment = ${JSON.stringify(hubDeployment(baseDomain), null, 2)};\n`);
  ' "$module" "$BASE_DOMAIN"
  rm -f "$module.map"
  echo "Baked the hosts of $BASE_DOMAIN into wgc" >&2
}

# npm takes a bundled dependency and everything it depends on from inside the tarball, so wgc.tgz
# carries the SDK with its own dependencies and needs no registry for it.
bundle_sdk_into_wgc() {
  local unpacked="$work_dir/wgc-unpacked"
  local sdk_project="$work_dir/sdk-project"

  mkdir -p "$unpacked" "$sdk_project"
  tar -xzf "$output_dir/wgc.tgz" -C "$unpacked"
  bake_deployment "$unpacked/package"
  # tsc compiles cli/test and cli/e2e into dist too; their fixtures name production hosts.
  rm -rf "$unpacked/package/dist/test" "$unpacked/package/dist/e2e"

  echo '{ "name": "sdk-project", "private": true }' > "$sdk_project/package.json"
  (cd "$sdk_project" && npm install --no-audit --no-fund --ignore-scripts --omit=dev "$output_dir/wgc-plugin-sdk.tgz" >&2)
  cp -R "$sdk_project/node_modules" "$unpacked/package/node_modules"
  rm -f "$unpacked/package/node_modules/.package-lock.json"

  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
    manifest.name = "@wundergraph/wgcm";
    manifest.bin = { wgcm: "dist/src/index.js" };
    manifest.bundleDependencies = ["@wundergraph/wgc-plugin-sdk"];
    fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  ' "$unpacked/package/package.json"

  mkdir -p "$work_dir/wgc-bundled"
  (cd "$unpacked/package" && npm pack --pack-destination "$work_dir/wgc-bundled" >&2)
  mv "$work_dir/wgc-bundled"/*.tgz "$output_dir/wgc.tgz"
  echo "Packed $output_dir/wgc.tgz as @wundergraph/wgcm with the plugin SDK bundled" >&2
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

"$repo_root/cli-plugins/scripts/check-packed-hosts.sh" "$output_dir" "$BASE_DOMAIN"

ls -1 "$output_dir"/*.tgz
