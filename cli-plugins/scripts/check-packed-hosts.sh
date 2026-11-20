#!/usr/bin/env bash
# Fails when a tarball packed for a Hub deployment names a WunderGraph host other than the
# documentation site or the deployment's own hosts, and prints each file:line that does.
#
# Usage: cli-plugins/scripts/check-packed-hosts.sh <dir-with-tarballs> <base-domain>
set -euo pipefail

tarball_dir="$1"
base_domain="$2"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

allowed_hosts=(cosmo-docs.wundergraph.com)
found=0

for tarball in "$tarball_dir"/*.tgz; do
  name="$(basename "$tarball")"
  mkdir -p "$work_dir/$name"
  tar -xzf "$tarball" -C "$work_dir/$name"

  while IFS= read -r match; do
    host="${match##*:}"
    if [[ " ${allowed_hosts[*]} " == *" $host "* || "$host" == *".$base_domain" ]]; then
      continue
    fi
    echo "$name: ${match#"$work_dir/$name/"}" >&2
    found=1
  done < <(grep -rnoaE '([A-Za-z0-9-]+\.)+wundergraph\.com' "$work_dir/$name" || true)
done

if [[ "$found" -ne 0 ]]; then
  echo "The tarballs above name WunderGraph production hosts. Route them through cli/src/core/deployment.ts." >&2
  exit 1
fi
echo "No WunderGraph production host in $tarball_dir" >&2
