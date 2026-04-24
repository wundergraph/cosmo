#!/usr/bin/env bash
set -euo pipefail

ROUTER_GRAPHQL_URL="${ROUTER_GRAPHQL_URL:-http://localhost:3002/graphql}"
PRODUCTS_URL="${PRODUCTS_URL:-http://localhost:4011}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$KIT_DIR/docker-compose.yml}"

query='{"query":"query Product($id: ID!) { product(id: $id) { id sku name } }","variables":{"id":"p1"}}'

stat_value() {
  curl -fsS "$PRODUCTS_URL/stats" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).stats.product))'
}

docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli FLUSHDB >/dev/null
curl -fsS -X POST "$PRODUCTS_URL/reset" >/dev/null

before="$(stat_value)"
first="$(curl -fsS -X POST "$ROUTER_GRAPHQL_URL" -H 'content-type: application/json' --data "$query")"
mid="$(stat_value)"
second="$(curl -fsS -X POST "$ROUTER_GRAPHQL_URL" -H 'content-type: application/json' --data "$query")"
after="$(stat_value)"
docker compose -f "$COMPOSE_FILE" restart router >/dev/null
"$SCRIPT_DIR/wait-router.sh" >/dev/null
third="$(curl -fsS -X POST "$ROUTER_GRAPHQL_URL" -H 'content-type: application/json' --data "$query")"
after_restart="$(stat_value)"

printf 'First response:  %s\n' "$first"
printf 'Second response: %s\n' "$second"
printf 'After router restart response: %s\n' "$third"
printf 'Products subgraph product resolver calls: before=%s first=%s second=%s after_router_restart=%s\n' "$before" "$mid" "$after" "$after_restart"

if [[ "$first" != *'"Widget"'* || "$second" != *'"Widget"'* || "$third" != *'"Widget"'* ]]; then
  printf 'Expected every response to contain the example product.\n' >&2
  exit 1
fi

if [[ "$before" != "0" || "$mid" != "1" || "$after" != "1" || "$after_restart" != "1" ]]; then
  printf 'Expected cold request to call the products subgraph once, warm request to use cache, and post-restart request to use Redis-backed L2.\n' >&2
  exit 1
fi

printf 'Smoke test passed. The repeated product query was served from cache, and Redis-backed L2 survived a router restart.\n'
