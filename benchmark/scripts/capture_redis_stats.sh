#!/usr/bin/env bash
set -euo pipefail

PHASE="${1:?usage: capture_redis_stats.sh <phase> <output-dir>}"
OUTPUT_DIR="${2:?usage: capture_redis_stats.sh <phase> <output-dir>}"
REDIS_CONTAINER="${BENCHMARK_REDIS_CONTAINER:-cosmo-benchmark-redis}"

mkdir -p "${OUTPUT_DIR}"

docker exec "${REDIS_CONTAINER}" redis-cli INFO > "${OUTPUT_DIR}/redis-info-${PHASE}.txt"
docker stats --no-stream --format '{{json .}}' "${REDIS_CONTAINER}" \
  > "${OUTPUT_DIR}/redis-docker-stats-${PHASE}.json"
