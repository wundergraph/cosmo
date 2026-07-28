#!/bin/bash
# Shared helpers for the ei-demo scripts. Sourced, not executed directly.

# This repo's compose and hub's both define a service named "postgres" on the
# same shared network, so inside a container that name resolves to two
# addresses and which one Keycloak binds to is decided by DNS answer order.
# Naming the container removes the ambiguity. Exported here rather than in a
# single script because every entry point that brings infra up needs it: a
# later `docker compose up` without it computes a different config for the
# keycloak service and silently recreates the container back onto the
# ambiguous name (confirmed directly, that is exactly how start.sh undid the
# bootstrap's binding). See RUNBOOK.md.
export POSTGRES_HOST="${POSTGRES_HOST:-cosmo-dev-postgres-1}"

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
  if grep -q '^NEXT_PUBLIC_ENABLE_ENTITY_INTELLIGENCE=true$' "$frontend_env"; then
    echo "Entity Intelligence flag already set in $frontend_env."
    return 0
  fi
  echo "NEXT_PUBLIC_ENABLE_ENTITY_INTELLIGENCE=true" >> "$frontend_env"
  echo "Entity Intelligence flag set in $frontend_env."
  # 2, not 0: the flag was missing until now, so any frontend already running
  # compiled without it and will keep hiding Entity Intelligence until it is
  # restarted. Callers that did not start the frontend themselves need to know.
  return 2
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
  local token_response user_token token_error userinfo kc_sub kc_groups db_id db_orgs
  token_response="$(curl -s -X POST "$kc_url/realms/cosmo/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=cosmo-cli -d scope=openid \
    -d "username=$demo_email" -d "password=$demo_password")" || true
  user_token="$(printf '%s' "$token_response" | python3 -c "import json,sys
try:
    print(json.load(sys.stdin).get('access_token', ''))
except Exception:
    print('')")"
  if [ -z "$user_token" ]; then
    # Keycloak's own error code separates the two very different causes here,
    # so the message points at the right one instead of always blaming login.
    token_error="$(printf '%s' "$token_response" | python3 -c "import json,sys
try:
    print(json.load(sys.stdin).get('error', ''))
except Exception:
    print('')")"
    case "$token_error" in
      invalid_client|unauthorized_client)
        echo "ERROR: hub's keycloak has no usable 'cosmo-cli' client in its 'cosmo' realm." >&2
        echo "       That realm is imported from hub's docker/keycloak/cosmo.json, so this" >&2
        echo "       usually means hub's keycloak database predates it. Recreate it:" >&2
        echo "         (cd \$HUB_DIR && docker compose --file docker-compose.yml down -v \\" >&2
        echo "            && POSTGRES_HOST=hub-dev-postgres-1 make all)" >&2
        ;;
      *)
        echo "ERROR: the demo user cannot log in to hub's keycloak at $kc_url (realm cosmo)." >&2
        echo "       Keycloak said: ${token_error:-no response}. Hub's own login will fail the" >&2
        echo "       same way. Check hub's keycloak is up, then run:" >&2
        echo "         ./scripts/ei-demo/align-hub-identity.sh" >&2
        ;;
    esac
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
  # Mirrors the control plane exactly: it reads groups[0] and takes the segment
  # after the leading slash (AccessTokenAuthenticator). Membership alone is not
  # enough, a leftover group ordered first resolves to that org instead and the
  # demo org is never reached, so check the first entry rather than the set.
  kc_first_org="$(printf '%s' "$userinfo" | python3 -c "import json,sys
try:
    g = json.load(sys.stdin).get('groups') or []
    print(g[0].split('/')[1] if g else '')
except Exception:
    print('')")"

  if [ "$kc_first_org" != "wundergraph" ]; then
    echo "ERROR: hub's keycloak does not put the demo user's 'wundergraph' group first." >&2
    echo "       Groups: ${kc_groups:-none}" >&2
    echo "       The control plane reads only the first one, so it would resolve" >&2
    echo "       '${kc_first_org:-no organization}' and hub would show 'Create organization'." >&2
    echo "       Fix with: ./scripts/ei-demo/align-hub-identity.sh" >&2
    return 1
  fi

  # Hub does not present this cosmo token itself: it logs the user into its own
  # "hub" realm and then exchanges that for a cosmo one at the broker endpoint,
  # which only works while the hub-realm user carries a federated identity
  # pointing at this exact cosmo user, plus the broker's read-token role. Hub's
  # `link-cosmo-idp` establishes both during `make all`, a step the bootstrap
  # skips whenever hub's dev servers are already up, so the link can easily be
  # missing or left pointing at a replaced cosmo user. Neither shows up in the
  # checks above, and both surface only as an empty org list. Needs
  # kc_admin_token from keycloak.sh, which every caller sources alongside this.
  local admin_token hub_user_id linked_cosmo_id broker_roles
  admin_token="$(kc_admin_token "$kc_url")" || {
    echo "ERROR: could not get an admin token for hub's keycloak at $kc_url to check the" >&2
    echo "       Cosmo identity-provider link. Is hub's keycloak healthy?" >&2
    return 1
  }
  hub_user_id="$(curl -s -H "Authorization: Bearer $admin_token" \
    "$kc_url/admin/realms/hub/users?email=$demo_email&exact=true" \
    | python3 -c "import json,sys
try:
    d = json.load(sys.stdin)
    print(d[0]['id'] if d else '')
except Exception:
    print('')")"
  if [ -z "$hub_user_id" ]; then
    echo "ERROR: $demo_email does not exist in hub's own 'hub' realm, so hub has nobody to log in." >&2
    echo "       Run hub's setup: (cd \$HUB_DIR && POSTGRES_HOST=hub-dev-postgres-1 make all)" >&2
    return 1
  fi

  linked_cosmo_id="$(curl -s -H "Authorization: Bearer $admin_token" \
    "$kc_url/admin/realms/hub/users/$hub_user_id/federated-identity" \
    | python3 -c "import json,sys
try:
    print(next((i.get('userId', '') for i in json.load(sys.stdin) if i.get('identityProvider') == 'cosmo-oidc'), ''))
except Exception:
    print('')")"
  if [ "$linked_cosmo_id" != "$kc_sub" ]; then
    echo "ERROR: hub's user is not linked to the current Cosmo identity." >&2
    echo "       linked to: ${linked_cosmo_id:-<no cosmo-oidc link>}, expected: $kc_sub" >&2
    echo "       Hub exchanges its own token for a Cosmo one through this link, so without" >&2
    echo "       it every call to the control plane fails and hub offers 'Create organization'." >&2
    if [ -z "$linked_cosmo_id" ]; then
      echo "       Fix with: (cd \$HUB_DIR/apps/backend && bun run link-cosmo-idp)" >&2
    else
      # link-cosmo-idp skips any user that already has a link, whatever it
      # points at, so a stale one has to be removed before it will rebuild it.
      echo "       The link exists but points elsewhere, and link-cosmo-idp skips users that" >&2
      echo "       already have one, so remove the stale link first, then rebuild it:" >&2
      echo "         curl -s -X DELETE -H \"Authorization: Bearer \\\$TOKEN\" \\" >&2
      echo "           $kc_url/admin/realms/hub/users/$hub_user_id/federated-identity/cosmo-oidc" >&2
      echo "         (cd \$HUB_DIR/apps/backend && bun run link-cosmo-idp)" >&2
    fi
    return 1
  fi

  broker_roles="$(curl -s -H "Authorization: Bearer $admin_token" \
    "$kc_url/admin/realms/hub/users/$hub_user_id/role-mappings" \
    | python3 -c "import json,sys
try:
    d = json.load(sys.stdin)
    print(','.join(r['name'] for c in (d.get('clientMappings') or {}).values() for r in c.get('mappings', [])))
except Exception:
    print('')")"
  case ",$broker_roles," in
    *",read-token,"*) ;;
    *)
      echo "ERROR: hub's user lacks the broker 'read-token' role, so it cannot exchange its" >&2
      echo "       token for a Cosmo one and the organization list comes back empty." >&2
      # link-cosmo-idp grants this role only while creating a missing link, and
      # skips any user that already has one. Since the link is present by the
      # time this check runs, running it alone would report success and change
      # nothing, so the link has to be removed first to make it rebuild both.
      echo "       The identity-provider link already exists, and link-cosmo-idp skips users" >&2
      echo "       that have one, so it grants the role only after the link is removed:" >&2
      echo "         curl -s -X DELETE -H \"Authorization: Bearer \\\$TOKEN\" \\" >&2
      echo "           $kc_url/admin/realms/hub/users/$hub_user_id/federated-identity/cosmo-oidc" >&2
      echo "         (cd \$HUB_DIR/apps/backend && bun run link-cosmo-idp)" >&2
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

  # Hub's backend talks to keycloak as a confidential client whose secret lives
  # in its own .env. A realm recreated from the committed import while that file
  # kept an older secret fails every admin call with a bare "invalid_client",
  # which cost a teammate a morning: hub's own link-cosmo-idp died on it with no
  # indication that a local file had drifted. Probing the credential here turns
  # that into a named cause. Skipped rather than failed when the file or keys
  # are absent, since neither is this script's to create.
  local hub_env admin_client admin_secret probe_error
  hub_env="${HUB_DIR:-../hub}/apps/backend/.env"
  if [ -f "$hub_env" ]; then
    admin_client="$(sed -n 's/^KEYCLOAK_ADMIN_CLIENT_ID=//p' "$hub_env" | tr -d '"' | head -1)"
    admin_secret="$(sed -n 's/^KEYCLOAK_ADMIN_CLIENT_SECRET=//p' "$hub_env" | tr -d '"' | head -1)"
    if [ -n "$admin_client" ] && [ -n "$admin_secret" ]; then
      probe_error="$(curl -s -X POST "$kc_url/realms/hub/protocol/openid-connect/token" \
        -d grant_type=client_credentials -d "client_id=$admin_client" -d "client_secret=$admin_secret" \
        | python3 -c "import json,sys
try:
    d = json.load(sys.stdin)
    print('' if 'access_token' in d else d.get('error', 'no token returned'))
except Exception:
    print('unreadable response')")"
      if [ -n "$probe_error" ]; then
        echo "ERROR: hub's backend cannot authenticate to its own keycloak as '$admin_client'." >&2
        echo "       Keycloak said: $probe_error" >&2
        echo "       KEYCLOAK_ADMIN_CLIENT_SECRET in $hub_env no longer matches the realm," >&2
        echo "       usually because the realm was recreated while that file kept an older" >&2
        echo "       secret. Every admin call fails this way, including link-cosmo-idp." >&2
        echo "       Restore the committed default and re-add your own values:" >&2
        echo "         cp \$HUB_DIR/apps/backend/.env.example \$HUB_DIR/apps/backend/.env" >&2
        echo "       then put LIVEBLOCKS_SECRET_KEY back and re-run." >&2
        return 1
      fi
    fi
  fi

  echo "Identity chain verified: $demo_email -> $kc_sub -> org 'wundergraph'."
}
