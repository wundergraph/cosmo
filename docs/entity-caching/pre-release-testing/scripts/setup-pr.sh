#!/usr/bin/env bash
set -euo pipefail

PR="${1:-2777}"
DEST="${2:-$PWD/cosmo-entity-caching-pr-$PR}"
BRANCH="entity-caching-pr-$PR"

if [[ ! -d "$DEST/.git" ]]; then
  git clone https://github.com/wundergraph/cosmo.git "$DEST"
fi

cd "$DEST"
git fetch origin "pull/$PR/merge:$BRANCH"
git checkout "$BRANCH"
corepack enable
pnpm install

printf 'Ready: %s\n' "$DEST"
