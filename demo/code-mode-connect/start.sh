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

# Yoko is a separate service expected at http://127.0.0.1:3400. start.sh no
# longer launches a local mock — bring up your real yoko service before running.
YOKO_URL="${YOKO_URL:-http://127.0.0.1:3400}"

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

on_signal() {
  trap - EXIT INT TERM
  kill_pid_file
  exit 0
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

if [ ! -f "$YOKO_DIR/config.json" ]; then
  echo "Composed yoko supergraph not found: $YOKO_DIR/config.json" >&2
  echo "Run: cd $YOKO_DIR && make compose" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
mkdir -p "$GOCACHE_DIR"
rm -f "$PID_FILE"
trap cleanup EXIT
trap on_signal INT TERM

# Verify the external yoko service is reachable. We don't probe a specific
# path because the real service doesn't necessarily expose /health — just
# confirm the TCP/HTTP socket accepts a connection. Any HTTP response (200,
# 404, 405 …) means the server is up; only a connection failure aborts.
# Override with YOKO_URL when yoko runs at a different address.
if ! curl -sS -o /dev/null --max-time 3 "$YOKO_URL" >/dev/null 2>&1; then
  echo "Yoko service is not reachable at $YOKO_URL" >&2
  echo "Start your yoko service (or set YOKO_URL=...) before running this demo." >&2
  exit 1
fi
echo "yoko is ready at $YOKO_URL"

echo "Starting router in foreground (CWD=$YOKO_DIR)"
echo "Router output is being teed to $LOG_DIR/router.log"
# Tee stdout+stderr so the user still sees live output AND we keep a persistent
# log for post-mortem debugging when the router exits unexpectedly.
(
  cd "$YOKO_DIR"
  exec "$ROUTER_BIN" -config "$ROUTER_CONFIG"
) 2>&1 | tee "$LOG_DIR/router.log" &
router_pid="$!"
append_pid router "$router_pid"

wait "$router_pid"
