#!/usr/bin/env bash
# Rebuild the monday.com file tree and grade every case's actual.graphql (the
# sub-agent's filesystem-generated query) against expected.graphql (the canonical
# query from monday's docs).
#
# Usage:
#   ./run.sh                 # download the live SDL from monday.com
#   ./run.sh path/to.graphql # use a local SDL file instead
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"

sdl="${1:-https://api.monday.com/v2/get_schema?format=sdl}"

bin="$(mktemp -d)/graphql-fs"
( cd "$root" && go build -o "$bin" . )

tree="$(mktemp -d)/monday-tree"
"$bin" build -sdl "$sdl" -out "$tree" >/dev/null
echo "file tree: $tree"
echo "types: $(ls "$tree/types" | wc -l)  queries: $(ls "$tree/query" | wc -l)  mutations: $(ls "$tree/mutation" | wc -l)"
echo

for d in "$here"/case*/; do
  name="$(basename "$d")"
  if [[ ! -f "$d/actual.graphql" ]]; then
    echo "##### $name — no actual.graphql, skipping"
    continue
  fi
  echo "############### $name ###############"
  "$bin" compare -sdl "$sdl" -expected "$d/expected.graphql" -generated "$d/actual.graphql"
  echo
done
