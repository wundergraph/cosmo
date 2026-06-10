#!/usr/bin/env bash
set -euo pipefail

REDIS_CONTAINER="${BENCHMARK_REDIS_CONTAINER:-cosmo-benchmark-redis}"
CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-1}"
CURL_MAX_TIME="${CURL_MAX_TIME:-2}"
REDIS_TIMEOUT="${REDIS_TIMEOUT:-2}"

probe() {
  curl -fsS --connect-timeout "${CURL_CONNECT_TIMEOUT}" --max-time "${CURL_MAX_TIME}" "$1" >/dev/null
}

check_ready() {
  timeout "${REDIS_TIMEOUT}" docker exec "${REDIS_CONTAINER}" redis-cli ping | rg -q '^PONG$' &&
    probe http://127.0.0.1:8088/metrics &&
    probe http://127.0.0.1:6060/debug/pprof/heap &&
    probe http://127.0.0.1:3002/ &&
    probe http://127.0.0.1:4012/ &&
    probe http://127.0.0.1:4013/ &&
    probe http://127.0.0.1:4014/
}

for _ in $(seq 1 60); do
  if check_ready; then
    exit 0
  fi
  sleep 1
done

echo "benchmark stack failed readiness checks" >&2
exit 1
