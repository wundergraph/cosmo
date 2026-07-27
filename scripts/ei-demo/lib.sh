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

# kill_pid_group <pid> [signal]
# Signals <pid>'s actual process group (looked up fresh), then <pid> itself.
# "-$pid" alone assumes <pid> leads its own group, true for a job backgrounded
# directly under `set -m` but false for one backgrounded inside a
# synchronously-run subshell (confirmed directly: bootstrap-entity-
# intelligence-demo.sh's control-plane/hub-dev-server spawns inherit their
# ancestor's group instead of leading their own, so "-$pid" targets a group
# that doesn't exist and the real service, a child of <pid>, survives
# untouched). See RUNBOOK.md.
kill_pid_group() {
  local pid="$1" sig="${2:-TERM}" pgid
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
  [ -n "$pgid" ] && kill -"$sig" "-$pgid" 2>/dev/null
  kill -"$sig" "$pid" 2>/dev/null
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

# unapplied_controlplane_migrations
# Prints the tag of every migration in the branch's journal that is NOT recorded
# as applied in the control plane's DB, and returns 1 if there are any.
# `make migrate` can silently skip this branch's migrations when the postgres
# volume is stale or from another branch: drizzle applies migrations by their
# journal timestamp, not their content, so a volume whose newest applied
# timestamp is already past this branch's leaves those migrations unapplied. The
# schema then lags the code and only surfaces much later as a control-plane
# "internal error" on publish. Returns 0 (nothing printed) if the journal or
# drizzle bookkeeping can't be read, so the check never blocks the demo on its
# own infra hiccup.
unapplied_controlplane_migrations() {
  local journal="controlplane/migrations/meta/_journal.json"
  [ -f "$journal" ] || return 0
  local applied
  applied="$(docker exec cosmo-dev-postgres-1 psql -U postgres -d controlplane -t -A \
    -c "SELECT created_at FROM drizzle.__drizzle_migrations" 2>/dev/null)" || return 0
  printf '%s\n' "$applied" | python3 -c "
import json, sys
entries = json.load(open(sys.argv[1]))['entries']
applied = {line.strip() for line in sys.stdin if line.strip()}
missing = [e['tag'] for e in entries if str(e['when']) not in applied]
for tag in missing:
    print(tag)
sys.exit(1 if missing else 0)
" "$journal"
}

# ensure_sibling_on_branch <dir> <repo> <branch> <name>
# Guarantees <dir> is a checkout of <repo> on <branch>: clones it if missing,
# switches to <branch> if it's on the wrong one and the tree is clean, and
# hard-fails with an actionable message if the tree is dirty (never discards
# uncommitted work) or if <dir> exists but isn't a git repo. Replaces the old
# "warn and hope the developer noticed", which silently left the wrong branch
# checked out and broke a later step.
ensure_sibling_on_branch() {
  local dir="$1" repo="$2" branch="$3" name="$4"
  if [ ! -d "$dir" ]; then
    echo "Cloning $repo into $dir ($branch)..."
    git clone --branch "$branch" "$repo" "$dir"
    return
  fi
  if ! is_real_git_repo "$dir"; then
    echo "ERROR: $dir exists but isn't a git repository." >&2
    echo "       Remove it (or point $name at a real checkout), then re-run." >&2
    exit 1
  fi
  local current
  current="$(git -C "$dir" branch --show-current 2>/dev/null || true)"
  if [ "$current" = "$branch" ]; then
    echo "$name already on $branch."
    return
  fi
  if [ -n "$(git -C "$dir" status --porcelain --untracked-files=no)" ]; then
    echo "ERROR: $dir is on '$current', not '$branch', and has uncommitted changes." >&2
    echo "       Commit or stash them (or check out '$branch' yourself), then re-run." >&2
    echo "       The demo won't switch a dirty checkout, to avoid touching your work." >&2
    exit 1
  fi
  echo "Switching $name to '$branch' (was '$current')..."
  git -C "$dir" fetch origin "$branch" --quiet 2>/dev/null || true
  git -C "$dir" checkout "$branch" >/dev/null 2>&1 || {
    echo "ERROR: could not check out '$branch' in $dir. Check it out by hand, then re-run." >&2
    exit 1
  }
}

# enable_hub_ei_frontend_flag <hub-dir>
# Turns hub's Entity Intelligence flag on in the frontend .env. Must run BEFORE
# hub's `next dev` starts: NEXT_PUBLIC_* vars are compiled into the client
# bundle at server start, so a flag written after the frontend is already up
# never reaches it until a restart (confirmed directly: a fresh run set this
# after next dev had started and the EI panel stayed hidden). Appended, never
# sed-replaced: @next/env lets a later duplicate key win over an earlier one,
# so this never disturbs whatever value was already there. Returns 1 (with a
# message) if the frontend .env doesn't exist yet.
enable_hub_ei_frontend_flag() {
  local hub_dir="$1"
  local frontend_env="$hub_dir/apps/frontend/.env"
  if [ ! -f "$frontend_env" ]; then
    echo "WARNING: $frontend_env doesn't exist yet; run 'make all' in hub first." >&2
    return 1
  fi
  if ! grep -q '^NEXT_PUBLIC_ENABLE_ENTITY_INTELLIGENCE=true$' "$frontend_env"; then
    echo "NEXT_PUBLIC_ENABLE_ENTITY_INTELLIGENCE=true" >> "$frontend_env"
  fi
  echo "Entity Intelligence flag set in $frontend_env."
}

# controlplane_kc_api_url
# Prints the KC_API_URL of whatever process is listening on 3001, empty if the
# port is free or the value isn't in its environment. The demo's control plane
# must validate tokens against hub's keycloak, so one left over from ordinary
# cosmo work (which validates against cosmo's own) silently rejects every hub
# call. A bare port check can't tell the two apart. See RUNBOOK.md.
controlplane_kc_api_url() {
  local pid
  pid="$(lsof -tiTCP:3001 -sTCP:LISTEN 2>/dev/null | head -1)"
  [ -n "$pid" ] || return 0
  ps eww "$pid" 2>/dev/null | tr ' ' '\n' | sed -n 's/^KC_API_URL=//p' | head -1
}

# verify_demo_identity_chain [hub-keycloak-url]
# Proves the demo user will actually see the 'wundergraph' org in hub, before
# anything depends on it. Hub never reads keycloak groups itself: it asks the
# control plane, which validates the token against its own KC_API_URL, resolves
# the org from the groups claim, then checks membership in its database. Every
# link is checked here so a break names its own cause immediately, instead of
# surfacing minutes later as a browser timeout on a "Create organization"
# screen with nothing pointing at the real reason. Returns 1 on any broken link.
verify_demo_identity_chain() {
  local kc_url="${1:-http://localhost:8090}"
  local demo_email="foo@wundergraph.com"
  local demo_password="wunder@123"
  local pg_container="cosmo-dev-postgres-1"

  # cosmo-cli, not admin-cli: only the clients carrying the "groups" protocol
  # mapper (cosmo-cli/studio/hub-oidc in hub's committed realm import) put the
  # claim the control plane reads into the token, and cosmo-cli is the one that
  # is both public and direct-access-grant enabled. scope=openid is required or
  # the userinfo endpoint answers 403. Both confirmed directly against 8090.
  local user_token userinfo kc_sub kc_groups db_id db_orgs
  user_token="$(curl -s -X POST "$kc_url/realms/cosmo/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=cosmo-cli -d scope=openid \
    -d "username=$demo_email" -d "password=$demo_password" \
    | python3 -c "import json,sys
try:
    print(json.load(sys.stdin).get('access_token', ''))
except Exception:
    print('')")" || true
  if [ -z "$user_token" ]; then
    echo "ERROR: the demo user cannot log in to hub's keycloak at $kc_url (realm cosmo)." >&2
    echo "       Hub's login will fail the same way. Check that hub's keycloak is up," >&2
    echo "       then re-run: ./scripts/ei-demo/align-hub-identity.sh" >&2
    return 1
  fi

  userinfo="$(curl -s -H "Authorization: Bearer $user_token" \
    "$kc_url/realms/cosmo/protocol/openid-connect/userinfo")" || true
  kc_sub="$(printf '%s' "$userinfo" | python3 -c "import json,sys
try:
    print(json.load(sys.stdin).get('sub', ''))
except Exception:
    print('')")"
  kc_groups="$(printf '%s' "$userinfo" | python3 -c "import json,sys
try:
    print(','.join(json.load(sys.stdin).get('groups', []) or []))
except Exception:
    print('')")"

  case ",$kc_groups," in
    *",/wundergraph/"*|*",/wundergraph,"*) ;;
    *)
      echo "ERROR: the demo user has no 'wundergraph' group in hub's keycloak (groups: ${kc_groups:-none})." >&2
      echo "       The control plane resolves the organization from this claim, so hub would" >&2
      echo "       show 'Create organization' instead of the demo org." >&2
      echo "       Fix with: ./scripts/ei-demo/align-hub-identity.sh" >&2
      return 1
      ;;
  esac

  db_id="$(docker exec "$pg_container" psql -U postgres -d controlplane -t -A \
    -c "SELECT id FROM users WHERE email='$demo_email'" 2>/dev/null)" || true
  if [ "$db_id" != "$kc_sub" ]; then
    echo "ERROR: the control plane's user id does not match hub's keycloak id for $demo_email." >&2
    echo "       control plane: ${db_id:-<missing>}, hub keycloak: ${kc_sub:-<missing>}" >&2
    echo "       Hub's org lookup is keyed on the keycloak id, so it would find no membership." >&2
    echo "       Fix with: ./scripts/ei-demo/align-hub-identity.sh" >&2
    return 1
  fi

  db_orgs="$(docker exec "$pg_container" psql -U postgres -d controlplane -t -A \
    -c "SELECT o.slug FROM organization_members om JOIN organizations o ON o.id = om.organization_id WHERE om.user_id = '$db_id'" 2>/dev/null)" || true
  if ! printf '%s\n' "$db_orgs" | grep -qx 'wundergraph'; then
    echo "ERROR: the demo user is not a member of the 'wundergraph' organization in the control plane." >&2
    echo "       Found: ${db_orgs:-none}. Re-run the seed, then ./scripts/ei-demo/align-hub-identity.sh" >&2
    return 1
  fi

  echo "Identity chain verified: $demo_email -> $kc_sub -> org 'wundergraph'."
}
