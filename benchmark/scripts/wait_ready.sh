#!/usr/bin/env bash
set -euo pipefail

REDIS_CONTAINER="${BENCHMARK_REDIS_CONTAINER:-cosmo-benchmark-redis}"

check_ready() {
  docker exec "${REDIS_CONTAINER}" redis-cli ping | rg -q '^PONG$' &&
    curl -sf http://127.0.0.1:8088/metrics >/dev/null &&
    curl -sf http://127.0.0.1:6060/debug/pprof/heap >/dev/null &&
    curl -sf http://127.0.0.1:3002/ >/dev/null &&
    curl -sf http://127.0.0.1:4012/ >/dev/null &&
    curl -sf http://127.0.0.1:4013/ >/dev/null &&
    curl -sf http://127.0.0.1:4014/ >/dev/null
}

for _ in $(seq 1 60); do
  if check_ready; then
    exit 0
  fi
  sleep 1
done

echo "benchmark stack failed readiness checks" >&2
exit 1
