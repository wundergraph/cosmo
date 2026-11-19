#!/usr/bin/env bash
set -euo pipefail

fixture_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project="cosmo-execution-config-${RANDOM}"
compose=(docker compose -p "$project" -f "$fixture_dir/compose.yaml")
cleanup() {
  result=$?
  if [[ "$result" -ne 0 ]]; then
    "${compose[@]}" logs --no-color router composer || true
  fi
  "${compose[@]}" down --volumes --remove-orphans || true
  exit "$result"
}
trap cleanup EXIT

"${compose[@]}" up --build --wait router
"${compose[@]}" run --rm --no-deps test
