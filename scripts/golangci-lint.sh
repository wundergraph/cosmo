#!/usr/bin/env bash
# Runs the pinned golangci-lint, installing it into .bin on first use.
#
# .golangci-lint-version contains a single line in the format
#
#   <version>:<sha256 of golangci-lint-<version>-checksums.txt>
#
# e.g. v2.13.2:b5830eaec7cf0accdbfe3a27cc372c4987f80a22db494a6bacee287bf4b03c3c
#
# The release's checksums.txt is verified against the pinned hash, and the
# platform tarball is verified against checksums.txt before extracting it.
#
# To bump the version, verify the release and pin its checksums.txt:
#
#   V=x.y.z
#   gh release download "v$V" -R golangci/golangci-lint -p "golangci-lint-$V-checksums.txt"
#   gh release verify-asset "v$V" "golangci-lint-$V-checksums.txt" -R golangci/golangci-lint
#   echo "v$V:$(sha256sum "golangci-lint-$V-checksums.txt" | cut -d ' ' -f 1)" > .golangci-lint-version
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pin="$(cat "$repo_root/.golangci-lint-version")"
version="${pin%%:*}"
checksums_sha256="${pin#*:}"
bin_dir="$repo_root/.bin"
binary="$bin_dir/golangci-lint-$version"

verify() {
  local file="$1" expected="$2" actual
  actual="$(sha256sum "$file" | cut -d ' ' -f 1)"
  if [[ "$actual" != "$expected" ]]; then
    echo "Checksum mismatch for $(basename "$file"): expected $expected, got $actual" >&2
    exit 1
  fi
}

if [[ ! -x "$binary" ]]; then
  if [[ ! "$checksums_sha256" =~ ^[0-9a-f]{64}$ ]]; then
    echo ".golangci-lint-version must be <version>:<sha256 of the release's checksums.txt>" >&2
    exit 1
  fi

  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$(uname -m)" in
    x86_64 | amd64) arch=amd64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) arch="$(uname -m)" ;;
  esac

  release_url="https://github.com/golangci/golangci-lint/releases/download/$version"
  checksums="golangci-lint-${version#v}-checksums.txt"
  name="golangci-lint-${version#v}-$os-$arch"
  archive="$name.tar.gz"

  mkdir -p "$bin_dir"
  install_dir="$(mktemp -d "$bin_dir/.golangci-lint.XXXXXX")"
  trap 'rm -rf "$install_dir"' EXIT

  curl -sSfL -o "$install_dir/$checksums" "$release_url/$checksums"
  verify "$install_dir/$checksums" "$checksums_sha256"

  archive_sha256="$(awk -v f="$archive" '$2 == f { print $1 }' "$install_dir/$checksums")"
  if [[ -z "$archive_sha256" ]]; then
    echo "No checksum for $archive in $checksums" >&2
    exit 1
  fi

  curl -sSfL -o "$install_dir/$archive" "$release_url/$archive"
  verify "$install_dir/$archive" "$archive_sha256"

  tar -xzf "$install_dir/$archive" -C "$install_dir" "$name/golangci-lint"

  # Publish only the complete binary, including when lint commands start concurrently.
  mv "$install_dir/$name/golangci-lint" "$binary"
  rm -rf "$install_dir"
  trap - EXIT
fi

exec "$binary" "$@"
