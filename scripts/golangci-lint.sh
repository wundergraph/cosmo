#!/usr/bin/env bash
# Runs the pinned golangci-lint, installing it into .bin on first use.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(cat "$repo_root/.golangci-lint-version")"
bin_dir="$repo_root/.bin"
binary="$bin_dir/golangci-lint-$version"

if [[ ! -x "$binary" ]]; then
  mkdir -p "$bin_dir"
  install_dir="$(mktemp -d "$bin_dir/.golangci-lint.XXXXXX")"
  trap 'rm -rf "$install_dir"' EXIT

  # Fetch the installer from the same immutable release tag as the binary.
  curl -sSfL -o "$install_dir/install.sh" \
    "https://raw.githubusercontent.com/golangci/golangci-lint/$version/install.sh"
  sh "$install_dir/install.sh" -b "$install_dir" "$version"

  # Publish only the complete binary, including when lint commands start concurrently.
  mv "$install_dir/golangci-lint" "$binary"
  rm -rf "$install_dir"
  trap - EXIT
fi

exec "$binary" "$@"
