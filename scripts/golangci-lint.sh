#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(cat "$repo_root/.golangci-lint-version")"
bin_dir="$repo_root/.bin"
binary="$bin_dir/golangci-lint-$version"

if [[ ! -x "$binary" ]]; then
  mkdir -p "$bin_dir"
  install_dir="$(mktemp -d "$bin_dir/.golangci-lint.XXXXXX")"
  trap 'rm -rf "$install_dir"' EXIT

  curl -sSfL "https://raw.githubusercontent.com/golangci/golangci-lint/$version/install.sh" |
    sh -s -- -b "$install_dir" "$version"

  # Publish only the complete binary, including when lint commands start concurrently.
  mv "$install_dir/golangci-lint" "$binary"
  rmdir "$install_dir"
  trap - EXIT
fi

exec "$binary" "$@"
