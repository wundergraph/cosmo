#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$KIT_DIR/../../.." && pwd)"

GRAPH="${1:-$KIT_DIR/example/graph.yaml}"
OUT="${2:-$KIT_DIR/generated/config.json}"

mkdir -p "$(dirname "$OUT")"

if ! command -v pnpm >/dev/null 2>&1; then
  printf 'pnpm was not found. Run: make setup\n' >&2
  exit 1
fi

cd "$REPO_ROOT/cli"
pnpm tsx src/index.ts router compose -i "$GRAPH" -o "$OUT"

if command -v jq >/dev/null 2>&1; then
  tmp="$OUT.tmp"
  jq . "$OUT" > "$tmp"
  mv "$tmp" "$OUT"
fi

printf 'Wrote %s\n' "$OUT"
