#!/bin/bash
set -e

# Aligns the seeded cosmo user with the identity hub logs in with, so
# hub's "import from Cosmo" can list the wundergraph org. See RUNBOOK.md.
# Safe to run repeatedly: exits early when ids already match.

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/keycloak.sh"

KC_URL="http://localhost:8090"
DEMO_EMAIL="foo@wundergraph.com"
DEMO_PASSWORD="wunder@123"
PG_CONTAINER="cosmo-dev-postgres-1"

# Fails instead of skipping: an exit 0 here reads as "aligned" to every caller,
# so the run continued with a broken identity and only failed much later, on
# hub's "Create organization" screen, with nothing pointing back to this step.
if ! nc -z 127.0.0.1 8090 2>/dev/null; then
  echo "ERROR: hub's keycloak (8090) is not running, so the demo user cannot be aligned" >&2
  echo "       with the identity hub logs in with." >&2
  # POSTGRES_HOST is part of the command, not decoration: hub's compose reads
  # ${POSTGRES_HOST:-postgres}, and "postgres" resolves to two containers on
  # the shared network, so bringing hub's infra up without it can bind keycloak
  # to cosmo's database instead of its own. See RUNBOOK.md.
  echo "       Start hub's docker services, then re-run:" >&2
  echo "         (cd \$HUB_DIR && POSTGRES_HOST=hub-dev-postgres-1 make infra-up)" >&2
  exit 1
fi

TOKEN="$(kc_admin_token "$KC_URL")" || { echo "ERROR: could not obtain a hub Keycloak admin token." >&2; exit 1; }

# Each python3 call catches its own parse errors and prints an empty string
# instead of raising, and the assignment is guarded with `|| true`: without
# both, a malformed/unexpected Keycloak response makes python3 exit
# non-zero, which set -e turns into a hard abort with a raw traceback
# instead of a friendly error (confirmed directly).
find_hub_user_id() {
  curl -s -H "Authorization: Bearer $TOKEN" \
    "$KC_URL/admin/realms/cosmo/users?email=$DEMO_EMAIL&exact=true" \
    | python3 -c "import json,sys
try:
    d = json.load(sys.stdin)
    print(d[0]['id'] if d else '')
except Exception:
    print('')"
}

KC_ID="$(find_hub_user_id)" || true

if [ -z "$KC_ID" ]; then
  echo "Demo user missing from hub's cosmo realm, creating it..."
  curl -s -o /dev/null -X POST "$KC_URL/admin/realms/cosmo/users" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"username\":\"$DEMO_EMAIL\",\"email\":\"$DEMO_EMAIL\",\"firstName\":\"foo\",\"lastName\":\"user\",\"enabled\":true,\"emailVerified\":true,\"credentials\":[{\"type\":\"password\",\"value\":\"$DEMO_PASSWORD\",\"temporary\":false}]}"
  KC_ID="$(find_hub_user_id)" || true
  [ -n "$KC_ID" ] || { echo "ERROR: could not fetch the newly created hub Keycloak user id." >&2; exit 1; }
fi

DB_ID="$(docker exec "$PG_CONTAINER" psql -U postgres -d controlplane -t -A \
  -c "SELECT id FROM users WHERE email='$DEMO_EMAIL'" 2>/dev/null)" || true

if [ -z "$DB_ID" ]; then
  echo "ERROR: no '$DEMO_EMAIL' user in the control plane DB, run the seed first." >&2
  exit 1
fi

if [ "$KC_ID" = "$DB_ID" ]; then
  echo "Identities already aligned ($KC_ID)."
  rm -f "/tmp/ei-demo-fresh-identity-$DB_ID"
else
  UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  if ! [[ "$KC_ID" =~ $UUID_RE ]] || ! [[ "$DB_ID" =~ $UUID_RE ]]; then
    echo "ERROR: KC_ID ('$KC_ID') or DB_ID ('$DB_ID') is not a plain UUID; refusing to splice it into SQL." >&2
    exit 1
  fi

  # foo@wundergraph.com is cosmo's own shared default dev seed identity, not
  # exclusive to this demo: an id mismatch can be a pre-existing identity from
  # unrelated cosmo work, and remapping it would delete that row and break
  # normal cosmo login. Only remap an id bootstrap-entity-intelligence-demo.sh
  # marked as freshly created by its own seed step (a file, not an env var,
  # since this script can run standalone in a later shell), or an explicit
  # override. See RUNBOOK.md.
  if [ ! -f "/tmp/ei-demo-fresh-identity-$DB_ID" ] && [ "${EI_DEMO_ALLOW_IDENTITY_REMAP:-}" != "1" ]; then
    echo "ERROR: '$DEMO_EMAIL' already existed in the control plane DB before this run" >&2
    echo "       (control plane id $DB_ID), and hub's keycloak has a different id for it" >&2
    echo "       ($KC_ID). Remapping would delete the existing row and could break your" >&2
    echo "       normal cosmo login. If you're sure this identity is safe to remap, re-run" >&2
    echo "       with EI_DEMO_ALLOW_IDENTITY_REMAP=1." >&2
    exit 1
  fi

  echo "Remapping control plane user $DB_ID -> $KC_ID..."
  # FKs referencing users(id) are discovered and repointed dynamically so
  # new tables can't silently break this. Insert-new / repoint / delete-old,
  # since the FKs block a direct primary key update.
  docker exec -i "$PG_CONTAINER" psql -U postgres -d controlplane -v ON_ERROR_STOP=1 <<SQL
DO \$\$
DECLARE r RECORD;
BEGIN
  INSERT INTO users (id, email) VALUES ('$KC_ID', 'remap-in-progress@local');
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.confrelid = 'users'::regclass AND c.contype = 'f'
  LOOP
    EXECUTE format('UPDATE %s SET %I = %L WHERE %I = %L', r.tbl, r.col, '$KC_ID', r.col, '$DB_ID');
  END LOOP;
  DELETE FROM users WHERE id = '$DB_ID';
  UPDATE users SET email = '$DEMO_EMAIL' WHERE id = '$KC_ID';
END
\$\$;
SQL
  echo "Identity alignment complete."
  rm -f "/tmp/ei-demo-fresh-identity-$DB_ID"
fi

# The org comes from userInfo's "groups" claim, populated from hub's OWN
# keycloak, separate group state from what cosmo's own keycloak got during
# seed. Without a matching group here, hub falls back to "Create organization".
echo "Aligning Keycloak group membership with control plane org membership..."
docker exec "$PG_CONTAINER" psql -U postgres -d controlplane -t -A -F'|' \
  -c "SELECT o.slug FROM organization_members om JOIN organizations o ON o.id = om.organization_id WHERE om.user_id = '$KC_ID'" \
  > /tmp/ei-demo-user-org-slugs.txt

curl -s -H "Authorization: Bearer $TOKEN" "$KC_URL/admin/realms/cosmo/users/$KC_ID/groups" \
  > /tmp/ei-demo-current-groups.json

# Values reach Python via env vars/files, never spliced into the source
# below (the heredoc delimiter is quoted, so bash does no substitution on it).
KC_URL="$KC_URL" KC_ID="$KC_ID" TOKEN="$TOKEN" python3 <<'PYEOF'
import json, os, subprocess, sys, time
import urllib.parse

kc_url = os.environ["KC_URL"]
kc_id = os.environ["KC_ID"]
token = os.environ["TOKEN"]

with open("/tmp/ei-demo-user-org-slugs.txt") as f:
    desired_slugs = {line.strip() for line in f if line.strip()}

def api(method, path, body=None):
    args = ["curl", "-s", "-X", method, "-H", f"Authorization: Bearer {token}"]
    if body is not None:
        args += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    args.append(f"{kc_url}{path}")
    out = subprocess.run(args, capture_output=True, text=True).stdout
    return json.loads(out) if out.strip() else None

def find_top_level_group(name):
    for g in api("GET", "/admin/realms/cosmo/groups?search=" + urllib.parse.quote(name, safe="")) or []:
        if g["name"] == name:
            return g
    return None

def find_subgroup(parent, name):
    for sg in api("GET", f"/admin/realms/cosmo/groups/{parent['id']}/children") or []:
        if sg["name"] == name:
            return sg
    return None

# A group is not always visible to a GET right after its own POST creates
# it (the same Keycloak eventual-consistency lag documented elsewhere in
# this script family). A short poll here avoids a raw None['id'] crash on
# a transient lag; a clear error if it genuinely never shows up still lets
# align-hub-identity.sh's own outer retry take over.
def poll_for(lookup, description, attempts=5, delay=1):
    for _ in range(attempts):
        found = lookup()
        if found is not None:
            return found
        time.sleep(delay)
    print(f"ERROR: {description} did not become visible after creation.", file=sys.stderr)
    sys.exit(1)

for slug in desired_slugs:
    top = find_top_level_group(slug)
    if top is None:
        print(f"Creating group '{slug}'...")
        api("POST", "/admin/realms/cosmo/groups", {"name": slug})
        top = poll_for(lambda: find_top_level_group(slug), f"group '{slug}'")
    admin_sub = find_subgroup(top, "admin")
    if admin_sub is None:
        print(f"Creating subgroup '{slug}/admin'...")
        api("POST", f"/admin/realms/cosmo/groups/{top['id']}/children", {"name": "admin"})
        admin_sub = poll_for(lambda: find_subgroup(top, "admin"), f"subgroup '{slug}/admin'")
    print(f"Adding user to '/{slug}/admin'...")
    api("PUT", f"/admin/realms/cosmo/users/{kc_id}/groups/{admin_sub['id']}")

with open("/tmp/ei-demo-current-groups.json") as f:
    current = json.load(f)
for g in current:
    top_slug = g["path"].split("/")[1]
    if top_slug not in desired_slugs:
        print(f"Removing stale group membership '{g['path']}'...")
        api("DELETE", f"/admin/realms/cosmo/users/{kc_id}/groups/{g['id']}")
PYEOF
rm -f /tmp/ei-demo-user-org-slugs.txt /tmp/ei-demo-current-groups.json
echo "Group alignment complete."
