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
source "$SCRIPT_DIR/lib.sh"
cd "$SCRIPT_DIR/../.."

PID_FILE="${EI_DEMO_PID_FILE:-/tmp/ei-demo.pids}"

if [ ! -f "$PID_FILE" ]; then
  echo "No $PID_FILE found, nothing to stop (or it already stopped cleanly)."
else
  echo "Stopping ei-demo processes..."
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    # "still exists" doesn't rule out the OS having recycled this pid onto
    # an unrelated process since it was recorded, more likely here than in
    # start.sh's own prune since down.sh often runs well after the
    # recording session ended. pidfile_entry_still_valid compares the
    # process's actual start time against what was recorded (see lib.sh),
    # which works for every spawn shape, unlike an earlier command-line
    # guess that missed real ei-demo processes, e.g. graphqlmetrics's
    # "make dev" (confirmed directly). See RUNBOOK.md.
    if ! pidfile_entry_still_valid "$line"; then
      echo "WARNING: pidfile entry '$line' no longer matches a live process with that start time (possibly reused); skipping." >&2
      continue
    fi
    pid="${line%%:*}"
    kill_pid_group "$pid"
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

if [ "${DOWN_INFRA:-}" = "1" ]; then
  echo "Stopping docker infra (DOWN_INFRA=1)..."
  make infra-down
fi
