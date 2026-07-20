#!/bin/bash
# Shared helpers for the ei-demo scripts. Sourced, not executed directly.

# pidfile_entry <pid>
# Prints "pid:start_time" for a live process, empty if it can't be found.
# start_time (`ps -o lstart=`, fixed at process creation) is what later lets
# a pidfile reader tell a still-alive pid from one the OS recycled onto an
# unrelated process, since a command-line guess isn't reliable across every
# spawn shape (a "go run" subshell execs into "go run ...", but "make dev"
# execs into "make dev" with no shared substring, and a multi-statement
# subshell may not exec at all). See RUNBOOK.md.
pidfile_entry() {
  local pid="$1" start
  start="$(ps -o lstart= -p "$pid" 2>/dev/null)"
  [ -n "$start" ] && printf '%s:%s\n' "$pid" "$start"
}

# pidfile_entry_still_valid <line>
# True if a "pid:start_time" pidfile entry still refers to a live process
# whose actual start time matches what was recorded.
pidfile_entry_still_valid() {
  local line="$1" pid="${1%%:*}" recorded="${1#*:}" live
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  live="$(ps -o lstart= -p "$pid" 2>/dev/null)"
  [ -n "$live" ] && [ "$live" = "$recorded" ]
}

# wait_for_port <port> <attempts> <sleep-seconds>
# Polls 127.0.0.1:<port> until it accepts a connection. Returns 1 on
# timeout instead of exiting, so each caller decides what failure means
# and prints its own message.
wait_for_port() {
  local port="$1" attempts="$2" sleep_s="$3"
  local i
  for i in $(seq 1 "$attempts"); do
    nc -z 127.0.0.1 "$port" 2>/dev/null && return 0
    sleep "$sleep_s"
  done
  return 1
}

# is_real_git_repo <dir>
# True if <dir> is itself a git repo root (plain clone or worktree), not
# just nested inside some unrelated ancestor repo. `git rev-parse
# --is-inside-work-tree` alone isn't enough for that distinction: it also
# returns true for a directory that merely lives inside a different repo
# (confirmed directly). pwd -P matches git's own symlink-resolved output
# (confirmed directly on macOS, where /tmp is a symlink to /private/tmp).
is_real_git_repo() {
  local dir="$1"
  local toplevel dir_abs
  toplevel="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || return 1
  dir_abs="$(cd "$dir" && pwd -P)"
  [ "$toplevel" = "$dir_abs" ]
}

# run_with_timeout <seconds> <command...>
# GNU timeout doesn't exist on stock macOS (and gtimeout only with
# coreutils), so a bare `timeout ...` fails with 127 there and the
# command never runs at all. Falls back to a background job with a
# watcher that kills it after the deadline.
run_with_timeout() {
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
    return
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
    return
  fi
  "$@" &
  local pid=$!
  # A killed command can leave grandchildren behind (confirmed directly: a
  # stuck "router plugin build" process survived a 180s deadline, see
  # RUNBOOK.md), killing just $pid doesn't reach them. Under job control
  # (set -m, true for this function's only caller) the backgrounded job gets
  # its own process group equal to $pid, so -$pid reaches the whole tree.
  # Falls back to a plain $pid kill without job control, to avoid signalling
  # the calling script's own process group by accident.
  local kill_target="$pid"
  case "$-" in
    *m*) kill_target="-$pid" ;;
    *) echo "WARNING: run_with_timeout without job control (no 'set -m'); a timed-out command's own children may survive." >&2 ;;
  esac
  ( sleep "$secs"; kill -9 "$kill_target" 2>/dev/null ) &
  local watcher=$!
  local rc=0
  wait "$pid" || rc=$?
  kill "$watcher" 2>/dev/null
  return "$rc"
}
