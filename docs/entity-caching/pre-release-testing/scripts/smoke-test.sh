#!/usr/bin/env bash
set -euo pipefail

ROUTER_GRAPHQL_URL="${ROUTER_GRAPHQL_URL:-http://localhost:3002/graphql}"
PRODUCTS_URL="${PRODUCTS_URL:-http://localhost:4011}"

query='{"query":"query Product($id: ID!) { product(id: $id) { id sku name } }","variables":{"id":"p1"}}'

stat_value() {
  curl -fsS "$PRODUCTS_URL/stats" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).stats.product))'
}

curl -fsS -X POST "$PRODUCTS_URL/reset" >/dev/null

before="$(stat_value)"
first="$(curl -fsS -X POST "$ROUTER_GRAPHQL_URL" -H 'content-type: application/json' --data "$query")"
second="$(curl -fsS -X POST "$ROUTER_GRAPHQL_URL" -H 'content-type: application/json' --data "$query")"
after="$(stat_value)"

printf 'First response:  %s\n' "$first"
printf 'Second response: %s\n' "$second"
printf 'Products subgraph product resolver calls: before=%s after=%s\n' "$before" "$after"

if [[ "$first" != *'"Widget"'* || "$second" != *'"Widget"'* ]]; then
  printf 'Expected both responses to contain the example product.\n' >&2
  exit 1
fi

if (( after > before + 1 )); then
  printf 'Expected the second request to be served from cache; product resolver was called more than once.\n' >&2
  exit 1
fi

printf 'Smoke test passed. The repeated product query was served without a second products subgraph root fetch.\n'
