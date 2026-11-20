#!/usr/bin/env bash
# Builds wgc and the plugin packages and packs them as tarballs with stable names for one Hub
# deployment, which serves them under https://<hub>/cli:
#
#   npm i -g --allow-remote=all https://<hub>/cli/wgc.tgz
#   wgc plugins install hub
#
# The packed wgc has the deployment's hosts baked in and installs plugins from the same URL, so it
# needs no environment variables; they still override the baked hosts. BASE_DOMAIN names the
# deployment: cosmo.<base> is the control plane, studio.<base> Studio, hub.<base> Hub and Keycloak,
# cdn.<base> the CDN. BASE_DOMAIN=localhost is the local install on its fixed ports. A Hub
# deployment's wgc sends telemetry only with COSMO_TELEMETRY_ENABLED=true and does not check npm for
# updates. The pack fails when a tarball still names a WunderGraph production host.
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

if [[ "$BASE_DOMAIN" == localhost ]]; then
  cosmo_api_url=http://localhost:4431
  cosmo_web_url=http://localhost:4430
  hub_url=http://localhost:4400
  cdn_url=http://localhost:4487
  keycloak_url=http://localhost:4480
else
  cosmo_api_url="https://cosmo.$BASE_DOMAIN"
  cosmo_web_url="https://studio.$BASE_DOMAIN"
  hub_url="https://hub.$BASE_DOMAIN"
  cdn_url="https://cdn.$BASE_DOMAIN"
  keycloak_url="$hub_url"
fi

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

# Replaces the compiled Cosmo Cloud hosts of cli/src/core/deployment.ts with the deployment's.
bake_deployment() {
  local module="$1/dist/src/core/deployment.js"

  if [[ ! -f "$module" ]]; then
    echo "$module is missing; cli/src/core/deployment.ts must compile to it." >&2
    exit 1
  fi

  node -e '
    const [module, cosmoApiUrl, cosmoWebUrl, hubUrl, cdnUrl, keycloakUrl] = process.argv.slice(1);
    const deployment = { kind: "hub", cosmoApiUrl, cosmoWebUrl, hubUrl, cdnUrl, keycloakUrl, cliPackagesUrl: `${hubUrl}/cli` };
    require("node:fs").writeFileSync(module, `export const deployment = ${JSON.stringify(deployment, null, 2)};\n`);
  ' "$module" "$cosmo_api_url" "$cosmo_web_url" "$hub_url" "$cdn_url" "$keycloak_url"
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

"$repo_root/cli-plugins/scripts/check-packed-hosts.sh" "$output_dir" "$BASE_DOMAIN"

ls -1 "$output_dir"/*.tgz
