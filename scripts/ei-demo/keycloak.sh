#!/bin/bash
# Keycloak readiness/recovery helpers for the ei-demo bootstrap. Sourced,
# not executed directly. Background on why each workaround exists:
# scripts/ei-demo/RUNBOOK.md.

# The demo has exactly one Keycloak: hub's. Hub brokers every login through
# it, the control plane validates tokens against it, and the seed registers
# the demo identity there, so this is the only instance any of the helpers
# below should ever touch. Cosmo's own Keycloak takes no part in the flow.
DEMO_KC_URL="${DEMO_KC_URL:-http://localhost:8090}"

# kc_admin_token [base-url] [attempts]
# Defaults to the demo's keycloak, 3 attempts. Retries because a single
# admin-login attempt can transiently fail even right after the readiness
# check reports ready (see RUNBOOK.md). Prints the token, empty on failure.
kc_admin_token() {
  local base_url="${1:-$DEMO_KC_URL}"
  local attempts="${2:-3}"
  local kc_token attempt
  for attempt in $(seq 1 "$attempts"); do
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
    "$DEMO_KC_URL/admin/realms/cosmo/groups?search=wundergraph&exact=true" \
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

# EI_DEMO_FORCE_KC_CLEANUP=1 authorizes deleting a "wundergraph" group that
# predates this run, the one case cleanup_stray_wundergraph_kc_state refuses on
# purpose (it can be real state on a keycloak shared with other work). Deletes
# it through the admin API and clears the baseline, so the guard then sees a
# clean slate and the group's stray wundergraph:* roles get swept by the normal
# per-attempt cleanup. A raw SQL delete can't stand in here: keycloak's database
# is not reliably the one a container name suggests, so the API is the only
# target that is always correct. See RUNBOOK.md. No-ops unless the flag is set
# and a baseline group was recorded.
force_delete_baseline_wundergraph_kc_group() {
  [ "${EI_DEMO_FORCE_KC_CLEANUP:-}" = "1" ] || return 0
  [ -n "${WUNDERGRAPH_KC_GROUP_BASELINE_ID:-}" ] || return 0
  local kc_token
  kc_token="$(kc_admin_token)" || {
    echo "WARNING: EI_DEMO_FORCE_KC_CLEANUP=1 set, but no admin token could be obtained to delete the pre-existing 'wundergraph' group; leaving it in place." >&2
    return 0
  }
  echo "EI_DEMO_FORCE_KC_CLEANUP=1: deleting pre-existing 'wundergraph' group ($WUNDERGRAPH_KC_GROUP_BASELINE_ID) so the demo can seed." >&2
  local delete_code
  delete_code="$(curl -s -o /dev/null -w '%{http_code}' -X DELETE -H "Authorization: Bearer $kc_token" \
    "$DEMO_KC_URL/admin/realms/cosmo/groups/$WUNDERGRAPH_KC_GROUP_BASELINE_ID")"
  # The baseline is only cleared once the group is really gone, so a failed
  # delete leaves the guard that protects pre-existing state still armed.
  case "$delete_code" in
    2*)
      WUNDERGRAPH_KC_GROUP_BASELINE_ID=""
      ;;
    *)
      echo "WARNING: deleting the 'wundergraph' group failed (HTTP $delete_code); leaving the safety" >&2
      echo "         baseline in place so recovery still refuses to drop the keycloak database." >&2
      ;;
  esac
}

# A TCP-open port isn't enough (Keycloak accepts connections mid-migration),
# and one successful admin login isn't enough either (it can still answer
# "user_not_found" intermittently right after). Require several consecutive
# successes before trusting it. Sets kc_ready and code as globals for the
# caller to inspect.
wait_for_demo_keycloak() {
  kc_ready=""
  local consecutive_ok=0
  local i
  for i in $(seq 1 150); do
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$DEMO_KC_URL/realms/master/protocol/openid-connect/token" \
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
      "$DEMO_KC_URL/admin/realms/cosmo/groups/$group_id"
  fi

  # pipefail scoped locally: a "curl | python3 | while read" pipe's exit
  # status is otherwise just the while loop's (always 0), which would hide
  # a real curl/python failure as "no stray roles found". Captured into
  # role_sweep_rc (not `|| true`, which would discard it before this line
  # ever sees it) so a real failure here is actually surfaced, not just
  # relied on to show up indirectly via the poll below.
  local role_sweep_rc
  set -o pipefail
  curl -s -H "Authorization: Bearer $kc_token" "$DEMO_KC_URL/admin/realms/cosmo/roles" \
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
      "$DEMO_KC_URL/admin/realms/cosmo/roles/$encoded"
  done
  role_sweep_rc=$?
  set +o pipefail
  [ "$role_sweep_rc" = "0" ] || echo "WARNING: role listing/deletion pipeline failed; some stray wundergraph:* roles may remain." >&2

  # A prior attempt's in-flight role-creation requests can still land on
  # Keycloak after that attempt's process has exited, racing the delete
  # above. Poll until a fresh read genuinely shows zero.
  local i remaining
  for i in $(seq 1 10); do
    remaining="$(curl -s -H "Authorization: Bearer $kc_token" "$DEMO_KC_URL/admin/realms/cosmo/roles" \
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
