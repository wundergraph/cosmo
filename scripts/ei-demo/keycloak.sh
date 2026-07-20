#!/bin/bash
# Keycloak readiness/recovery helpers for the ei-demo bootstrap. Sourced,
# not executed directly. Background on why each workaround exists:
# scripts/ei-demo/RUNBOOK.md.

# kc_admin_token [base-url]
# Defaults to cosmo's own keycloak; align-hub-identity.sh passes hub's
# (localhost:8090) to reuse this instead of a separate copy. Retries because
# a single admin-login attempt can transiently fail even right after
# wait_for_cosmo_keycloak reports ready (see RUNBOOK.md). Prints the token,
# empty on failure.
kc_admin_token() {
  local base_url="${1:-http://localhost:8080}"
  local kc_token attempt
  for attempt in 1 2 3; do
    kc_token="$(curl -s -X POST "$base_url/realms/master/protocol/openid-connect/token" \
      -d "grant_type=password" -d "client_id=admin-cli" -d "username=admin" -d "password=changeme" \
      | python3 -c "import json,sys
try:
    d = json.load(sys.stdin)
    print(d.get('access_token', '') if isinstance(d, dict) else '')
except Exception:
    print('')")" || true
    [ -n "$kc_token" ] && { printf '%s' "$kc_token"; return 0; }
    sleep 2
  done
  return 1
}

# Prints the "wundergraph" group's id in cosmo's realm, empty if none exists.
find_wundergraph_kc_group_id() {
  local kc_token="$1"
  curl -s -H "Authorization: Bearer $kc_token" \
    "http://localhost:8080/admin/realms/cosmo/groups?search=wundergraph&exact=true" \
    | python3 -c "import json,sys
try:
    d = json.load(sys.stdin)
    print(d[0]['id'] if isinstance(d, list) and d else '')
except Exception:
    print('')"
}

# Records whether a "wundergraph" group already exists, so cleanup_stray_
# wundergraph_kc_state can tell state that predates this run apart from its
# own failed-attempt debris. Sets WUNDERGRAPH_KC_GROUP_BASELINE_ID as a
# global; empty means no group existed yet. See RUNBOOK.md.
snapshot_wundergraph_kc_group_baseline() {
  WUNDERGRAPH_KC_GROUP_BASELINE_ID=""
  local kc_token
  kc_token="$(kc_admin_token)" || return 0
  WUNDERGRAPH_KC_GROUP_BASELINE_ID="$(find_wundergraph_kc_group_id "$kc_token")"
}

# A TCP-open port isn't enough (Keycloak accepts connections mid-migration),
# and one successful admin login isn't enough either (this Keycloak build
# can still answer "user_not_found" intermittently right after). Require
# several consecutive successes before trusting it. Sets kc_ready and code
# as globals for the caller to inspect.
wait_for_cosmo_keycloak() {
  kc_ready=""
  local consecutive_ok=0
  local i
  for i in $(seq 1 150); do
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:8080/realms/master/protocol/openid-connect/token" \
      -d "grant_type=password" -d "client_id=admin-cli" -d "username=admin" -d "password=changeme" 2>/dev/null) || true
    if [ "$code" = "200" ]; then
      consecutive_ok=$((consecutive_ok + 1))
      [ "$consecutive_ok" -ge 3 ] && { kc_ready=1; break; }
    else
      consecutive_ok=0
    fi
    sleep 2
  done
}

# Recovery is one unit (drop/recreate/restart/wait): this Keycloak build's
# instability resurfaces unpredictably across group, role, and login calls.
# cosmo-dev-keycloak-1 is shared, general-purpose, not exclusive to this
# demo, so refuse if a realm besides master/cosmo exists, or a "wundergraph"
# group predates this run (WUNDERGRAPH_KC_GROUP_BASELINE_ID), a drop would
# destroy either too. Also refuses if no admin token can be obtained at all
# (kc_admin_token's own 3 retries exhausted): that's a much stronger signal
# than one transient parse hiccup, and proceeding blind is exactly the
# scenario these guards exist to prevent. See RUNBOOK.md.
recover_cosmo_keycloak() {
  if [ -n "${WUNDERGRAPH_KC_GROUP_BASELINE_ID:-}" ]; then
    echo "ERROR: cosmo-dev-keycloak-1 already had a 'wundergraph' group before this run started." >&2
    echo "       Automatic recovery drops the whole keycloak database, which would destroy it too." >&2
    echo "       Clean it up by hand if it's stale, or investigate if it's real, then re-run." >&2
    return 1
  fi

  local kc_token foreign_realms
  kc_token="$(kc_admin_token)" || {
    echo "ERROR: could not obtain a Keycloak admin token to check for foreign realms or pre-existing state." >&2
    echo "       Automatic recovery drops the whole keycloak database; refusing without being able to verify what's on it." >&2
    echo "       Once you've confirmed it's safe, recover by hand: docker stop cosmo-dev-keycloak-1 && docker exec cosmo-dev-postgres-1 psql -U postgres -c 'DROP DATABASE keycloak' -c 'CREATE DATABASE keycloak' && docker start cosmo-dev-keycloak-1" >&2
    return 1
  }
  foreign_realms="$(curl -s -H "Authorization: Bearer $kc_token" "http://localhost:8080/admin/realms" \
    | python3 -c "import json,sys
try:
    d = json.load(sys.stdin)
    names = [r['realm'] for r in d if isinstance(d, list) and r.get('realm') not in ('master', 'cosmo')]
    print(','.join(names))
except Exception:
    print('')")" || true
  if [ -n "$foreign_realms" ]; then
    echo "ERROR: cosmo-dev-keycloak-1 has realm(s) besides 'master'/'cosmo': $foreign_realms" >&2
    echo "       Automatic recovery drops the whole keycloak database, which would destroy them too." >&2
    echo "       Back them up (or move them off this instance) and re-run, or recover by hand narrowed to the cosmo realm." >&2
    return 1
  fi

  echo "Recovering cosmo's keycloak (dropping and recreating its database)..." >&2
  docker stop cosmo-dev-keycloak-1
  docker exec cosmo-dev-postgres-1 psql -U postgres -c 'DROP DATABASE keycloak' -c 'CREATE DATABASE keycloak'
  docker start cosmo-dev-keycloak-1
  wait_for_cosmo_keycloak
  [ -n "$kc_ready" ] || {
    echo "cosmo keycloak still did not become ready after automatic recovery (last admin login HTTP status: $code)." >&2
    echo "Try manually: docker stop cosmo-dev-keycloak-1 && docker exec cosmo-dev-postgres-1 psql -U postgres -c 'DROP DATABASE keycloak' -c 'CREATE DATABASE keycloak' && docker start cosmo-dev-keycloak-1" >&2
    return 1
  }
  # Database (and any baseline group) was just wiped: re-snapshot so
  # cleanup_stray_wundergraph_kc_state's baseline reflects reality now.
  snapshot_wundergraph_kc_group_baseline
}

# seed.ts's group+role creation isn't atomic against a fresh Keycloak and
# can leave orphaned wundergraph:* groups/roles behind on a failed attempt,
# which make the next plain retry fail differently (409 vs 404). Sweep both
# before every seed attempt so retries start from a known-clean state.
cleanup_stray_wundergraph_kc_state() {
  local kc_token
  kc_token="$(kc_admin_token)" || { echo "WARNING: could not obtain a Keycloak admin token this attempt; skipping cleanup." >&2; return 0; }

  local group_id
  group_id="$(find_wundergraph_kc_group_id "$kc_token")" || true
  # A group here can be real state from other cosmo work sharing this
  # instance. One that predates this run (snapshot_wundergraph_kc_group_
  # baseline) is never touched, here or for its roles. Returns 2 (distinct
  # from 0) so the caller can tell "blocked by real state" apart from
  # "nothing to clean", retrying seed.ts won't help either way, since it
  # silently no-ops whenever this group already exists. See RUNBOOK.md.
  if [ -n "$group_id" ] && [ "$group_id" = "${WUNDERGRAPH_KC_GROUP_BASELINE_ID:-}" ]; then
    echo "Existing 'wundergraph' Keycloak group predates this run; leaving it and its roles alone." >&2
    return 2
  fi

  if [ -n "$group_id" ]; then
    curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $kc_token" \
      "http://localhost:8080/admin/realms/cosmo/groups/$group_id"
  fi

  # pipefail scoped locally: a "curl | python3 | while read" pipe's exit
  # status is otherwise just the while loop's (always 0), which would hide
  # a real curl/python failure as "no stray roles found". Captured into
  # role_sweep_rc (not `|| true`, which would discard it before this line
  # ever sees it) so a real failure here is actually surfaced, not just
  # relied on to show up indirectly via the poll below.
  local role_sweep_rc
  set -o pipefail
  curl -s -H "Authorization: Bearer $kc_token" "http://localhost:8080/admin/realms/cosmo/roles" \
    | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    data = []
for r in (data if isinstance(data, list) else []):
    if r['name'].startswith('wundergraph:'):
        print(r['name'])
" | while IFS= read -r role_name; do
    encoded="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$role_name")"
    curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $kc_token" \
      "http://localhost:8080/admin/realms/cosmo/roles/$encoded"
  done
  role_sweep_rc=$?
  set +o pipefail
  [ "$role_sweep_rc" = "0" ] || echo "WARNING: role listing/deletion pipeline failed; some stray wundergraph:* roles may remain." >&2

  # A prior attempt's in-flight role-creation requests can still land on
  # Keycloak after that attempt's process has exited, racing the delete
  # above. Poll until a fresh read genuinely shows zero.
  local i remaining
  for i in $(seq 1 10); do
    remaining="$(curl -s -H "Authorization: Bearer $kc_token" "http://localhost:8080/admin/realms/cosmo/roles" \
      | python3 -c "import json,sys
try:
    data = json.load(sys.stdin)
except Exception:
    data = []
print(sum(1 for r in (data if isinstance(data, list) else []) if r['name'].startswith('wundergraph:')))")" || true
    [ "$remaining" = "0" ] && break
    sleep 1
  done
  [ "$remaining" = "0" ] || echo "WARNING: stray wundergraph:* roles still present after polling; the next seed attempt may hit a 409 for one of them." >&2
}
