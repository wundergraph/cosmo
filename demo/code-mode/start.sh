#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo"
CODE_MODE_DIR="$DEMO_DIR/code-mode"
PID_FILE="/tmp/cosmo-code-mode-demo.pids"
LOG_DIR="/tmp/cosmo-code-mode-demo-logs"
GOCACHE_DIR="${GOCACHE:-/tmp/cosmo-code-mode-go-build-cache}"

ROUTER_BIN="$ROOT_DIR/router/router"
ROUTER_CONFIG="$CODE_MODE_DIR/router-config.yaml"
YOKO_BIN="$CODE_MODE_DIR/yoko-mock/yoko-mock"

append_pid() {
  local name="$1"
  local pid="$2"
  printf '%s %s\n' "$name" "$pid" >> "$PID_FILE"
}

kill_pid_file() {
  if [ ! -f "$PID_FILE" ]; then
    echo "No Code Mode demo PID file found at $PID_FILE"
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

start_background() {
  local name="$1"
  local cwd="$2"
  shift 2

  echo "Starting $name"
  (
    cd "$cwd"
    "$@"
  ) > "$LOG_DIR/$name.log" 2>&1 &
  append_pid "$name" "$!"
}

start_background_root() {
  local name="$1"
  shift

  echo "Starting $name"
  (
    cd "$ROOT_DIR"
    "$@"
  ) > "$LOG_DIR/$name.log" 2>&1 &
  append_pid "$name" "$!"
}

if [ "${1:-}" = "--down" ]; then
  kill_pid_file
  exit 0
fi

if [ ! -x "$ROUTER_BIN" ]; then
  echo "Router binary not found or not executable: $ROUTER_BIN" >&2
  echo "Run: cd router && make build" >&2
  exit 1
fi

if [ ! -x "$YOKO_BIN" ]; then
  echo "Yoko mock binary not found or not executable: $YOKO_BIN" >&2
  echo "Run: cd demo/code-mode/yoko-mock && go build -o yoko-mock ." >&2
  exit 1
fi

if [ ! -f "$CODE_MODE_DIR/config.json" ]; then
  echo "Composed router config not found: $CODE_MODE_DIR/config.json" >&2
  echo "Run: make -C demo/code-mode compose" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
mkdir -p "$GOCACHE_DIR"
rm -f "$PID_FILE"
trap cleanup EXIT INT TERM

start_background employees "$DEMO_DIR" env GOCACHE="$GOCACHE_DIR" PORT=4001 go run ./cmd/employees
start_background family "$DEMO_DIR" env GOCACHE="$GOCACHE_DIR" PORT=4002 go run ./cmd/family
start_background availability "$DEMO_DIR" env GOCACHE="$GOCACHE_DIR" PORT=4007 go run ./cmd/availability
start_background mood "$DEMO_DIR" env GOCACHE="$GOCACHE_DIR" PORT=4008 go run ./cmd/mood
start_background_root yoko "$YOKO_BIN" -listen-addr localhost:5028

wait_url employees http://localhost:4001/
wait_url family http://localhost:4002/
wait_url availability http://localhost:4007/
wait_url mood http://localhost:4008/
wait_url yoko http://localhost:5028/health

echo "Starting router in foreground"
"$ROUTER_BIN" -config "$ROUTER_CONFIG" &
router_pid="$!"
append_pid router "$router_pid"

wait "$router_pid"
