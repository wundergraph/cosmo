#!/bin/bash
# Stops every background process the demo recorded in the pidfile: what
# start.sh started (graphqlmetrics, demo subgraphs, traffic generation,
# the router) and what the bootstrap started (hub dev servers, control
# plane). Works even if start.sh's own trap never ran (e.g. the terminal
# was killed outright).
#
# Docker infra is left running by default, since it's shared with other
# Makefile targets, set DOWN_INFRA=1 to also run `make infra-down`.

SCRIPT_DIR="$(dirname "$0")"
cd "$SCRIPT_DIR/../.."

PID_FILE="${EI_DEMO_PID_FILE:-/tmp/ei-demo.pids}"

if [ ! -f "$PID_FILE" ]; then
  echo "No $PID_FILE found, nothing to stop (or it already stopped cleanly)."
else
  echo "Stopping ei-demo processes..."
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    kill -0 "$pid" 2>/dev/null || continue
    # "still exists" doesn't rule out the OS having recycled this pid onto
    # an unrelated process since it was recorded (the same reuse risk
    # start.sh's own prune exists for, larger here since down.sh often runs
    # well after the recording session ended), a command-line sanity check
    # catches the clearest case before sending a kill.
    case "$(ps -o command= -p "$pid" 2>/dev/null)" in
      *pnpm*|*"go run"*|*node*|*bun*) ;;
      *)
        echo "WARNING: pid $pid in $PID_FILE no longer looks like an ei-demo process (possibly reused); skipping." >&2
        continue
        ;;
    esac
    kill -TERM "-$pid" 2>/dev/null
    kill -TERM "$pid" 2>/dev/null
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

if [ "${DOWN_INFRA:-}" = "1" ]; then
  echo "Stopping docker infra (DOWN_INFRA=1)..."
  make infra-down
fi
