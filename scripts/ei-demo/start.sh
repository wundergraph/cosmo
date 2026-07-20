#!/bin/bash
set -e

# Starts the Entity Intelligence demo stack: bootstraps if needed, docker
# infra, control plane + graphqlmetrics + demo subgraphs, optional traffic
# generation, then the router. Counterpart: down.sh.

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/lib.sh"

cd "$SCRIPT_DIR/../.."

DEMO_STARTUP_ATTEMPTS="${DEMO_STARTUP_ATTEMPTS:-60}"
DEMO_STARTUP_SLEEP="${DEMO_STARTUP_SLEEP:-0.5}"
HUB_DIR="${HUB_DIR:-../hub}"

# down.sh's fallback if this process's own trap never runs (e.g. the
# terminal is killed outright): written incrementally as each pid is
# known, so a partial startup is still fully recoverable. The bootstrap
# appends its own long-lived spawns (hub dev servers, control plane) to
# the same file, so those survive into every rewrite below.
PID_FILE="${EI_DEMO_PID_FILE:-/tmp/ei-demo.pids}"
write_pidfile() {
  # Re-reads PID_FILE fresh on every call instead of a one-time snapshot,
  # so a concurrent invocation's pids never get silently dropped. See
  # RUNBOOK.md for why the read below needs its own "|| true".
  local current=""
  if [ -f "$PID_FILE" ]; then
    current="$(while IFS= read -r pid; do
      [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && echo "$pid"
    done < "$PID_FILE")" || true
  fi
  printf '%s\n' "$current" "$cp_pid" "$gqm_pid" "$sub_pid" "$traffic_pid" "$router_pid" | sort -u | grep -v '^$' > "$PID_FILE" || true
}
cp_pid=""
gqm_pid=""
sub_pid=""
traffic_pid=""
router_pid=""

# Prune once, up front, before bootstrap can run for minutes: otherwise a
# dead pid could get OS-recycled onto an unrelated live process before
# write_pidfile ever gets a chance to prune it. See RUNBOOK.md.
if [ -f "$PID_FILE" ]; then
  while IFS= read -r pid; do
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && echo "$pid"
  done < "$PID_FILE" > "$PID_FILE.tmp" || true
  mv "$PID_FILE.tmp" "$PID_FILE"
fi

echo "Bootstrapping (idempotent, skips anything already done)..."
./scripts/ei-demo/bootstrap-entity-intelligence-demo.sh

echo "Starting docker infra (postgres, clickhouse, redis, nats, keycloak)..."
make infra-up

echo "Waiting for ClickHouse to be healthy..."
docker compose --file docker-compose.yml --profile dev up --wait --wait-timeout 120 clickhouse \
  || { echo "ClickHouse did not become healthy" >&2; exit 1; }

echo "Starting control plane (if not already running), graphqlmetrics, and demo subgraphs..."
set -m

if nc -z 127.0.0.1 3001 2>/dev/null; then
  echo "Control plane already running (started during bootstrap)."
else
  NODE_BIN="$(./scripts/ei-demo/node-path.sh)" || exit 1
  # Hub's keycloak, passed as an env var rather than written into
  # controlplane/.env: see bootstrap-entity-intelligence-demo.sh's own
  # control-plane spawn for why.
  (cd controlplane && PATH="$NODE_BIN:$PATH" KC_API_URL="http://localhost:8090" KC_FRONTEND_URL="http://localhost:8090" pnpm dev) & cp_pid=$!
fi

if nc -z 127.0.0.1 4005 2>/dev/null; then
  echo "graphqlmetrics already running."
else
  (cd graphqlmetrics && make dev) & gqm_pid=$!
fi

if nc -z 127.0.0.1 4001 2>/dev/null; then
  echo "Demo subgraphs already running."
else
  (cd demo && go run cmd/all/main.go) & sub_pid=$!
fi
write_pidfile

if command -v k6 >/dev/null 2>&1 && [ -f "$HUB_DIR/scripts/ei-demo/run-traffic.sh" ]; then
  ( wait_for_port 3002 "$DEMO_STARTUP_ATTEMPTS" "$DEMO_STARTUP_SLEEP" || exit 0
    echo "Generating demo traffic (populates the Entity Intelligence heatmap)..."
    ROUTER_URL=http://localhost:3002/graphql bash "$HUB_DIR/scripts/ei-demo/run-traffic.sh" --vus 20 --duration 60s \
      > /tmp/ei-demo-traffic.log 2>&1 || echo "Traffic generation failed, see /tmp/ei-demo-traffic.log" >&2 ) & traffic_pid=$!
  write_pidfile
else
  echo "WARNING: k6 not installed or hub's run-traffic.sh not found; skipping automatic traffic generation." >&2
  echo "         The Entity Intelligence heatmap will stay empty until you run it yourself." >&2
fi

# Kills everything recorded in the pidfile, not just this shell's own
# jobs: bootstrap's spawns (hub dev servers, control plane) run in their
# own process groups since bootstrap uses set -m, so the group kill on
# $$ alone no longer reaches them.
cleanup() {
  # Each kill is its own guarded statement, not chained: an empty pid var
  # (unset until its own spawn point) makes that one kill fail, and under
  # set -e an unguarded failure here would abort the rest of cleanup
  # (confirmed directly), skipping the PID_FILE fallback below entirely.
  kill -TERM -$$ -$cp_pid -$gqm_pid -$sub_pid -$traffic_pid -$router_pid 2>/dev/null || true
  kill $cp_pid $gqm_pid $sub_pid $traffic_pid $router_pid 2>/dev/null || true
  if [ -f "$PID_FILE" ]; then
    while IFS= read -r pid; do
      [ -n "$pid" ] || continue
      kill -TERM "-$pid" 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  true
}
trap cleanup EXIT INT TERM HUP

for p in 3001 4005 4001 4002 4003 4004 4007 4008; do
  wait_for_port "$p" "$DEMO_STARTUP_ATTEMPTS" "$DEMO_STARTUP_SLEEP" || { echo "port $p did not start (control plane / graphqlmetrics / a subgraph)" >&2; exit 1; }
done

if nc -z 127.0.0.1 3002 2>/dev/null; then
  echo "Router already running at http://localhost:3002/, demo is already live."
  echo "Run 'make ei-demo-down' first if you want to restart it."
  # cleanup below tears down everything in the pidfile, correct when a
  # live session's own router exits, wrong here: this invocation never
  # became the session's owner, so its own exit must not kill the other
  # invocation's still-running stack.
  trap - EXIT INT TERM HUP
  exit 0
fi

echo "Starting router (entity caching + feature flag rollouts enabled)..."
echo "Playground will be at http://localhost:3002/"
(cd router && go run cmd/router/main.go) & router_pid=$!
write_pidfile
wait "$router_pid"
