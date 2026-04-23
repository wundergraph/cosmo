#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RUN_DIR="${BENCHMARK_RUN_DIR:-${ROOT_DIR}/benchmark/.run}"

stop_pid_file() {
  local pid_file="$1"
  if [[ ! -f "${pid_file}" ]]; then
    return 0
  fi
  local pid
  pid="$(cat "${pid_file}")"
  if kill -0 "${pid}" >/dev/null 2>&1; then
    # spawn_detached uses start_new_session=True, so the PID is not our child
    # and `wait` returns immediately. Poll with kill -0 until the process is
    # gone; after 5 s escalate to SIGKILL so a hung process can't orphan us.
    kill "${pid}" >/dev/null 2>&1 || true
    for _ in {1..20}; do
      kill -0 "${pid}" >/dev/null 2>&1 || break
      sleep 0.25
    done
    if kill -0 "${pid}" >/dev/null 2>&1; then
      kill -9 "${pid}" >/dev/null 2>&1 || true
      sleep 0.25
    fi
  fi
  rm -f "${pid_file}"
}

stop_pid_file "${RUN_DIR}/router.pid"
stop_pid_file "${RUN_DIR}/cache-demo.pid"

bash "${SCRIPT_DIR}/stop_redis.sh"
