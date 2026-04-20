#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

REDIS_PORT="${BENCHMARK_REDIS_PORT:-6399}"
REDIS_CONTAINER="${BENCHMARK_REDIS_CONTAINER:-cosmo-benchmark-redis}"
REDIS_IMAGE="${BENCHMARK_REDIS_IMAGE:-redis:7-alpine}"
RUN_DIR="${BENCHMARK_RUN_DIR:-${ROOT_DIR}/benchmark/.run}"

mkdir -p "${RUN_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to run benchmark Redis" >&2
  exit 1
fi

docker rm -f "${REDIS_CONTAINER}" >/dev/null 2>&1 || true

if lsof -iTCP:"${REDIS_PORT}" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  echo "benchmark Redis port ${REDIS_PORT} is already in use" >&2
  exit 1
fi

docker run -d \
  --name "${REDIS_CONTAINER}" \
  -p "${REDIS_PORT}:6379" \
  "${REDIS_IMAGE}" \
  redis-server --save "" --appendonly no >/dev/null

for _ in $(seq 1 30); do
  if docker exec "${REDIS_CONTAINER}" redis-cli ping >/dev/null 2>&1; then
    {
      echo "BENCHMARK_REDIS_CONTAINER=${REDIS_CONTAINER}"
      echo "BENCHMARK_REDIS_PORT=${REDIS_PORT}"
      echo "BENCHMARK_REDIS_IMAGE=${REDIS_IMAGE}"
    } > "${RUN_DIR}/redis.env"
    exit 0
  fi
  sleep 1
done

echo "benchmark Redis failed to become ready" >&2
docker logs "${REDIS_CONTAINER}" >&2 || true
exit 1
