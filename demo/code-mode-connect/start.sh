#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo"
CONNECT_DIR="$DEMO_DIR/code-mode-connect"
PID_FILE="/tmp/cosmo-code-mode-connect-demo.pids"
LOG_DIR="/tmp/cosmo-code-mode-connect-demo-logs"
GOCACHE_DIR="${GOCACHE:-/tmp/cosmo-code-mode-go-build-cache}"

# Yoko project that owns the supergraph + plugin binaries. Required:
# YOKO_DIR=/path/to/yoko ./start.sh
YOKO_DIR="${YOKO_DIR:?YOKO_DIR is required (path to your yoko checkout)}"

ROUTER_BIN="$ROOT_DIR/router/router"
ROUTER_CONFIG="$CONNECT_DIR/router-config.yaml"
YOKO_BIN="$DEMO_DIR/code-mode/yoko-mock/yoko-mock"

append_pid() {
  local name="$1"
  local pid="$2"
  printf '%s %s\n' "$name" "$pid" >> "$PID_FILE"
}

kill_pid_file() {
  if [ ! -f "$PID_FILE" ]; then
    echo "No code-mode-connect demo PID file found at $PID_FILE"
    return 0
  fi

  while read -r name pid; do
    [ -n "${pid:-}" ] || continue
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping $name pid=$pid"
      kill "$pid" 2>/dev/null || true
    fi
  done < "$PID_FILE"

  sleep 1

  while read -r name pid; do
    [ -n "${pid:-}" ] || continue
    if kill -0 "$pid" 2>/dev/null; then
      echo "Force stopping $name pid=$pid"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done < "$PID_FILE"

  rm -f "$PID_FILE"
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  kill_pid_file
  exit "$status"
}

wait_url() {
  local name="$1"
  local url="$2"
  local timeout="${3:-90}"
  local start
  start="$(date +%s)"

  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name is ready at $url"
      return 0
    fi

    if [ "$(( $(date +%s) - start ))" -ge "$timeout" ]; then
      echo "Timed out waiting for $name at $url" >&2
      echo "Logs are in $LOG_DIR" >&2
      return 1
    fi

    sleep 1
  done
}

start_background_root() {
  local name="$1"
  shift

  echo "Starting $name"
  # exec replaces the subshell with the binary, so $! is the binary's pid.
  # Without exec, the subshell forks the binary and `--down` ends up signalling
  # an already-exited subshell while the real process keeps running.
  (
    cd "$ROOT_DIR"
    exec "$@"
  ) > "$LOG_DIR/$name.log" 2>&1 &
  append_pid "$name" "$!"
}

if [ "${1:-}" = "--down" ]; then
  kill_pid_file
  exit 0
fi

if [ ! -d "$YOKO_DIR" ]; then
  echo "Yoko project directory not found: $YOKO_DIR" >&2
  echo "Set YOKO_DIR to override." >&2
  exit 1
fi

if [ ! -x "$ROUTER_BIN" ]; then
  echo "Router binary not found or not executable: $ROUTER_BIN" >&2
  echo "Run: cd router && make build" >&2
  exit 1
fi

if [ ! -x "$YOKO_BIN" ]; then
  echo "Yoko mock binary not found or not executable: $YOKO_BIN" >&2
  echo "Run: make -C demo/code-mode build-yoko" >&2
  exit 1
fi

if [ ! -f "$YOKO_DIR/config.json" ]; then
  echo "Composed yoko supergraph not found: $YOKO_DIR/config.json" >&2
  echo "Run: cd $YOKO_DIR && make compose" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
mkdir -p "$GOCACHE_DIR"
rm -f "$PID_FILE"
trap cleanup EXIT INT TERM

# yoko-mock listens on a different port than the regular code-mode-demo so the
# two demos can coexist (5028 vs 5038).
start_background_root yoko "$YOKO_BIN" -listen-addr localhost:5038

wait_url yoko http://localhost:5038/health

echo "Starting router in foreground (CWD=$YOKO_DIR)"
(
  cd "$YOKO_DIR"
  exec "$ROUTER_BIN" -config "$ROUTER_CONFIG"
) &
router_pid="$!"
append_pid router "$router_pid"

wait "$router_pid"
