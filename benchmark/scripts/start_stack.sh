#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RUN_DIR="${BENCHMARK_RUN_DIR:-${ROOT_DIR}/benchmark/.run}"

mkdir -p "${RUN_DIR}"

spawn_detached() {
  local log_file="$1"
  local pid_file="$2"
  local work_dir="$3"
  shift 3

  python3 - "$log_file" "$pid_file" "$work_dir" "$@" <<'PY'
import os
import subprocess
import sys

log_path, pid_path, work_dir, *cmd = sys.argv[1:]

with open(log_path, "ab") as log_file:
    proc = subprocess.Popen(
        cmd,
        cwd=work_dir,
        stdin=subprocess.DEVNULL,
        stdout=log_file,
        stderr=log_file,
        start_new_session=True,
    )

with open(pid_path, "w", encoding="utf-8") as pid_file:
    pid_file.write(f"{proc.pid}\n")
PY
}

assert_port_free() {
  local port="$1"
  if lsof -iTCP:"${port}" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    echo "required benchmark port ${port} is already in use" >&2
    exit 1
  fi
}

assert_port_free 3002
assert_port_free 4012
assert_port_free 4013
assert_port_free 4014
assert_port_free 6060
assert_port_free 8088
assert_port_free 6399

cd "${ROOT_DIR}"
make demo-compose

bash "${SCRIPT_DIR}/start_redis.sh"

(
  cd "${ROOT_DIR}/demo"
  env -u GOROOT go build -o "${RUN_DIR}/cache-demo.bin" ./cmd/cache-demo
)

(
  cd "${ROOT_DIR}/router"
  env -u GOROOT go build -o "${RUN_DIR}/router.bin" ./cmd/router
)

spawn_detached \
  "${RUN_DIR}/cache-demo.log" \
  "${RUN_DIR}/cache-demo.pid" \
  "${ROOT_DIR}/demo" \
  "${RUN_DIR}/cache-demo.bin"

spawn_detached \
  "${RUN_DIR}/router.log" \
  "${RUN_DIR}/router.pid" \
  "${ROOT_DIR}/router" \
  env ENGINE_ENABLE_SINGLE_FLIGHT=false \
  PROMETHEUS_ENABLED=true \
  PROMETHEUS_GRAPHQL_CACHE=true \
  ENGINE_DEBUG_ENABLE_CACHE_RESPONSE_HEADERS=true \
  TRACING_ENABLED=false \
  GOGC=200 \
  GOMEMLIMIT=4GiB \
  "${RUN_DIR}/router.bin" --config ../benchmark/router-cache.redis.yaml --pprof-addr :6060
