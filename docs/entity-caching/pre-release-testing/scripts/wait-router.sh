#!/usr/bin/env bash
set -euo pipefail

ROUTER_URL="${ROUTER_URL:-http://localhost:3002}"
PRODUCTS_URL="${PRODUCTS_URL:-http://localhost:4011}"

wait_for_url() {
  local name="$1"
  local url="$2"
  for _ in $(seq 1 90); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      printf '%s is ready: %s\n' "$name" "$url"
      return 0
    fi
    sleep 1
  done
  printf '%s did not become ready: %s\n' "$name" "$url" >&2
  return 1
}

wait_for_url products "$PRODUCTS_URL/health"
wait_for_url router "$ROUTER_URL/"
