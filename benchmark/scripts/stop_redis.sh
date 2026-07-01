#!/usr/bin/env bash
set -euo pipefail

REDIS_CONTAINER="${BENCHMARK_REDIS_CONTAINER:-cosmo-benchmark-redis}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to stop benchmark Redis" >&2
  exit 1
fi

docker rm -f "${REDIS_CONTAINER}" >/dev/null 2>&1 || true
