#!/bin/bash
set -e

# Full "clean clone -> working Entity Intelligence demo" bootstrap. Skips
# protobuf/connect codegen, see RUNBOOK.md. Safe to re-run at any point:
# every step checks its own state first.

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/lib.sh"
source "$SCRIPT_DIR/keycloak.sh"

cd "$SCRIPT_DIR/../.."

# Overridable for machines with more than one hub checkout (e.g. several
# git worktrees on different branches), defaults to the plain sibling
# directory a genuine fresh clone would have.
HUB_DIR="${HUB_DIR:-../hub}"
# Same override pattern as GGT_BRANCH in setup-router-config.sh: hub's
# Entity Intelligence work also lives on an unmerged feature branch, so
# this will need bumping once it lands on a stable branch upstream.
HUB_BRANCH="${HUB_BRANCH:-milinda/entity-intelligence-1}"
HUB_REPO="git@github.com:wundergraph/hub.git"

# Long-lived processes this script spawns (hub dev servers, control plane)
# are recorded here so down.sh can stop them, without this, `make
# ei-demo-down` only cleaned up what start.sh itself started and left
# these running. `set -m` gives each background job its own process
# group, so down.sh's group kill takes their children down too.
PID_FILE="${EI_DEMO_PID_FILE:-/tmp/ei-demo.pids}"
set -m

# A marker can be orphaned if align-hub-identity.sh's remap fails on every
# retry (set -e aborts before its own cleanup runs). Sweep ones a day old or
# more, well past any single run, so this can't accumulate indefinitely.
# -L: /tmp is a symlink on macOS, and -maxdepth without it silently matches
# nothing inside the target (confirmed directly).
find -L /tmp -maxdepth 1 -name 'ei-demo-fresh-identity-*' -mtime +1 -delete 2>/dev/null || true

echo "==> Prerequisites, install, build, docker infra (skipping codegen, see header)"
make prerequisites
pnpm install
# keycloak scaled to zero: this demo authenticates entirely against hub's
# keycloak, so starting cosmo's own leaves a second auth server running that
# nothing talks to, which is what made "which keycloak holds the identity"
# ambiguous in the first place. DC_FLAGS is the Makefile's own extension point
# and must be passed on the command line, since the Makefile assigns it and a
# plain environment variable would lose. POSTGRES_HOST (lib.sh) still pins the
# database host for anyone who starts cosmo's keycloak outside the demo.
make infra-up DC_FLAGS="--scale keycloak=0"
pnpm -r run --filter '!studio' build
# Plugin subgraphs aren't part of the EI demo, but their build is flaky
# (stale toolchain cache) and can hang silently for 15+ min instead of
# failing fast, hence the hard timeout, not just `|| continue`. See
# RUNBOOK.md.
run_with_timeout 180 make build-plugins || {
  echo "WARNING: plugin build failed or hung; continuing, the EI demo does not use plugin subgraphs." >&2
  echo "         To fix the plugin build itself: rm -rf \"\$HOME/Library/Application Support/cosmo/proto-tools\" and re-run." >&2
  pkill -9 -f "router plugin build" 2>/dev/null || true
}

# Must exist before migrate/seed: controlplane's own scripts (db-migrate.ts
# etc.) read DB_URL and friends straight out of controlplane/.env.
echo "==> .env files (controlplane, graphqlmetrics, router)"
[ -f controlplane/.env ] || cp controlplane/.env.example controlplane/.env
[ -f graphqlmetrics/.env ] || cp graphqlmetrics/.env.example graphqlmetrics/.env
[ -f router/.env ] || cp router/.env.example router/.env
[ -f cli/.env ] || cp cli/.env.example cli/.env

# Only created above if missing, so an existing router/.env from before
# the IPv4 fix would otherwise stay stale forever.
if grep -q '^GRAPHQL_METRICS_COLLECTOR_ENDPOINT=http://localhost:4005' router/.env 2>/dev/null; then
  echo "Correcting stale GRAPHQL_METRICS_COLLECTOR_ENDPOINT (localhost to 127.0.0.1)..."
  sed -i.bak 's#^GRAPHQL_METRICS_COLLECTOR_ENDPOINT=http://localhost:4005#GRAPHQL_METRICS_COLLECTOR_ENDPOINT=http://127.0.0.1:4005#' router/.env
  rm -f router/.env.bak
fi

# Hub must be up before the seed below: it brokers login through its own
# keycloak (8090), which must hold the same demo-user identity the seed
# creates (see align-hub-identity.sh). Bring it up here if needed, since
# hub is a sibling repo this repo's tooling can't depend on directly.
echo "==> Checking hub ($HUB_DIR)"
ensure_sibling_on_branch "$HUB_DIR" "$HUB_REPO" "$HUB_BRANCH" hub

# Whether hub is actually serving is decided by its dev servers (3301 frontend,
# 3305 backend), not its keycloak: keycloak is a docker container that outlives
# the terminal `bun run dev` runs in, so "keycloak up" can be true while hub
# itself is down. Key the decision off the servers the demo actually needs.
if nc -z 127.0.0.1 3301 2>/dev/null && nc -z 127.0.0.1 3305 2>/dev/null; then
  echo "hub's dev servers (3301/3305) already running."
  # The flag still has to be checked on this path. It used to be set only in
  # the branch below, so a developer who already had hub running (its normal
  # state) got a fully green run with Entity Intelligence silently missing:
  # the frontend they started compiled without the flag, and writing it later
  # cannot reach a running next dev. Stop instead of producing that demo.
  # Status captured in a condition context, not read from $? after a plain
  # call: under `set -e` a bare non-zero return aborts the script immediately,
  # so the arms below never ran and the abort surfaced as a bare exit right
  # after a success-sounding "flag set" line (confirmed directly).
  enable_hub_ei_frontend_flag "$HUB_DIR" && ei_flag_rc=0 || ei_flag_rc=$?
  case $ei_flag_rc in
    2)
      echo "ERROR: hub's frontend is already running but was started without Entity" >&2
      echo "       Intelligence enabled. The flag has now been written to" >&2
      echo "       $HUB_DIR/apps/frontend/.env, but a running next dev compiled its" >&2
      echo "       value in at startup and will keep hiding the feature." >&2
      echo "       Restart hub's dev servers, then re-run this demo." >&2
      exit 1
      ;;
    1)
      echo "ERROR: hub's frontend .env is missing; run 'make all' in $HUB_DIR first." >&2
      exit 1
      ;;
  esac
else
  echo "hub isn't fully running; setting it up..."
  # Hub's own postgres, for the same ambiguity reason as this repo's above.
  (cd "$HUB_DIR" && POSTGRES_HOST=hub-dev-postgres-1 make all)

  # LIVEBLOCKS_SECRET_KEY has no default in hub's own .env.example and hub's
  # backend won't boot without one (Config.redacted, no fallback). Not
  # something this script can generate, it's a real liveblocks.io account
  # secret. See RUNBOOK.md.
  HUB_BACKEND_ENV="$HUB_DIR/apps/backend/.env"
  if [ -n "${HUB_LIVEBLOCKS_SECRET_KEY:-}" ]; then
    echo "Setting LIVEBLOCKS_SECRET_KEY in $HUB_BACKEND_ENV..."
    sed -i.bak "s#^LIVEBLOCKS_SECRET_KEY=.*#LIVEBLOCKS_SECRET_KEY=${HUB_LIVEBLOCKS_SECRET_KEY}#" "$HUB_BACKEND_ENV"
    rm -f "$HUB_BACKEND_ENV.bak"
  elif ! grep -q '^LIVEBLOCKS_SECRET_KEY=.\+' "$HUB_BACKEND_ENV" 2>/dev/null; then
    echo "WARNING: LIVEBLOCKS_SECRET_KEY is empty in $HUB_BACKEND_ENV; hub's backend will fail to start." >&2
    echo "         Create a free account at https://liveblocks.io, grab a secret key, and either" >&2
    echo "         set it there by hand, or re-run with: make ei-demo HUB_LIVEBLOCKS_SECRET_KEY=sk_..." >&2
  fi

  # Must run before next dev starts, not later in setup-router-config.sh: a
  # NEXT_PUBLIC_* flag is compiled in at server start, so setting it afterward
  # leaves the running frontend with Entity Intelligence hidden. See lib.sh.
  enable_hub_ei_frontend_flag "$HUB_DIR" || true

  echo "Starting hub's dev servers in the background..."
  (cd "$HUB_DIR" && nohup bun run dev > /tmp/hub-dev.log 2>&1 & pid=$!; pidfile_entry "$pid" >> "$PID_FILE")
  echo "Waiting for hub's keycloak (8090)..."
  wait_for_port 8090 60 1 || {
    echo "ERROR: hub's keycloak (port 8090) did not come up after 'make all'. See errors above." >&2
    exit 1
  }
fi

# --wait uses docker-compose healthchecks instead of a plain port probe.
# --wait-timeout is required: Compose's own default is to wait forever.
echo "==> Waiting for postgres and ClickHouse to be healthy..."
docker compose --file docker-compose.yml --profile dev up --wait --wait-timeout 120 postgres clickhouse \
  || { echo "postgres/ClickHouse did not become healthy" >&2; exit 1; }

# align-hub-identity.sh stays out of this retry loop: it talks to hub's
# keycloak, a different failure domain than cosmo's own. See RUNBOOK.md.
run_migrate_and_seed() {
  local USER_COUNT seed_ok seed_attempt cleanup_rc FRESH_USER_ID
  echo "==> Database migrate"
  make migrate || return 1

  echo "==> Database seed (default local dev org/user)"
  # Hub's keycloak, the same one the control plane validates tokens against
  # everywhere else in this demo. Seeding into cosmo's own keycloak instead
  # created the identity in a server nothing at runtime consults, which is
  # what align-hub-identity.sh then had to repair by rewriting the control
  # plane's user id and every foreign key pointing at it. Seeding here means
  # the ids match from the start and that repair becomes a no-op. An older
  # comment claimed hub's keycloak refuses these calls; it does not, every
  # operation seed.ts performs (group, subgroup, realm role, user, membership)
  # was confirmed directly against 8090. Passed as env vars rather than
  # written into controlplane/.env: dotenv never overrides an already-set
  # process env var, so this reaches seed.ts without touching a file a
  # developer may have customised for other cosmo work. See RUNBOOK.md.
  export KC_API_URL="http://localhost:8090"
  export KC_FRONTEND_URL="http://localhost:8090"

  #
  # A failed query here must not fall through as "0 users": that's what
  # gates whether align-hub-identity.sh is later allowed to remap this
  # identity, so a docker/postgres hiccup misread as "empty" could unlock a
  # destructive remap of a real pre-existing identity. See RUNBOOK.md.
  USER_COUNT="$(docker exec cosmo-dev-postgres-1 psql -U postgres -d controlplane -t -A -c "SELECT count(*) FROM users" 2>/dev/null)" \
    || { echo "ERROR: could not query the control plane database for its user count." >&2; return 1; }
  if [ "$USER_COUNT" = "0" ]; then
    seed_ok=""
    for seed_attempt in 1 2 3 4 5; do
      cleanup_stray_wundergraph_kc_state
      cleanup_rc=$?
      # 2 means a real, pre-existing "wundergraph" group is blocking seed.ts
      # (it silently no-ops whenever that group already exists) and cleanup
      # correctly refused to delete it. Retrying cannot fix a deterministic
      # block, so bail here rather than burning the remaining attempts.
      if [ "$cleanup_rc" = "2" ]; then
        echo "ERROR: hub's keycloak already had a 'wundergraph' group before this run started, and seed.ts cannot proceed past it." >&2
        echo "       Clean it up by hand if it's stale, or investigate if it's real, then re-run." >&2
        echo "       If you're sure it's stale demo debris, re-run with: make ei-demo EI_DEMO_FORCE_KC_CLEANUP=1" >&2
        exit 1
      fi
      if make seed; then
        # A 0 exit isn't proof anything was seeded (seed.ts also exits 0 on
        # a no-op skip) and this Keycloak build can transiently misreport a
        # user as already existing, confirm a DB row actually landed, and
        # get its id directly rather than re-querying for it separately.
        FRESH_USER_ID="$(docker exec cosmo-dev-postgres-1 psql -U postgres -d controlplane -t -A -c "SELECT id FROM users WHERE email='foo@wundergraph.com'" 2>/dev/null)" \
          || { echo "ERROR: could not re-query the control plane database after seeding." >&2; return 1; }
        if [ -n "$FRESH_USER_ID" ]; then
          seed_ok=1
          # A marker file, not an env var: align-hub-identity.sh can run
          # standalone in a later shell (see its own header comment), which
          # would never inherit an exported var from this process. Keyed to
          # this exact id so it can't be mistaken for a different identity.
          touch "/tmp/ei-demo-fresh-identity-$FRESH_USER_ID"
          break
        fi
        echo "make seed attempt $seed_attempt reported success but wrote no DB rows (Keycloak eventual-consistency race), cleaning up and retrying..." >&2
      else
        echo "make seed attempt $seed_attempt failed (Keycloak group/role creation race), cleaning up and retrying..." >&2
      fi
    done
    [ -n "$seed_ok" ] || { echo "ERROR: make seed failed after 5 attempts." >&2; return 1; }
  else
    make seed || return 1
  fi
}

echo "==> Waiting for hub's keycloak (8090), the only one this demo uses, to be fully ready..."
wait_for_demo_keycloak
if [ -z "$kc_ready" ]; then
  echo "ERROR: hub's keycloak (8090) never became ready (last admin login HTTP status: $code)." >&2
  echo "       Everything below authenticates against it. Bring hub's docker services up" >&2
  echo "       Bring them up with the database host pinned, then re-run:" >&2
  echo "         (cd \$HUB_DIR && POSTGRES_HOST=hub-dev-postgres-1 make infra-up)" >&2
  echo "       ---- last 40 lines of hub-dev-keycloak-1 ----" >&2
  docker logs --tail 40 hub-dev-keycloak-1 2>&1 | sed 's/^/       /' >&2 || true
  exit 1
fi
# Attempted regardless: a single request can still get through even when the
# stricter 3-consecutive-successes threshold above did not, and any snapshot is
# strictly better than none for the baseline protection cleanup_stray_
# wundergraph_kc_state relies on.
snapshot_wundergraph_kc_group_baseline
# Opt-in only: if the run was started with EI_DEMO_FORCE_KC_CLEANUP=1, drop a
# pre-existing "wundergraph" group now so the guards below don't refuse on it.
force_delete_baseline_wundergraph_kc_group

# Plain retries, with no keycloak recovery step: the demo authenticates only
# against hub's keycloak, whose database also holds hub's own realm and users,
# so dropping and recreating it the way the old cosmo-keycloak recovery did is
# never an acceptable automatic action. seed.ts is idempotent, so a transient
# failure is worth retrying on its own.
migrate_seed_ok=""
for attempt in 1 2 3; do
  if run_migrate_and_seed; then
    migrate_seed_ok=1
    break
  fi
  echo "migrate/seed attempt $attempt failed, retrying..." >&2
  sleep 2
done
[ -n "$migrate_seed_ok" ] || { echo "ERROR: migrate/seed did not succeed after 3 full attempts." >&2; exit 1; }

# `make migrate` reports success even when a stale/cross-branch postgres volume
# left this branch's migrations unapplied (drizzle keys off timestamps, not
# content). The schema then lags the code and blows up much later as a cryptic
# control-plane "internal error" on subgraph publish. Catch it here instead.
echo "==> Verifying the control-plane schema is fully migrated..."
unapplied="$(unapplied_controlplane_migrations)" || {
  echo "ERROR: the control-plane database is missing migrations this branch expects:" >&2
  echo "$unapplied" | sed 's/^/         - /' >&2
  echo "       'make migrate' skipped them: your postgres volume is stale or from another" >&2
  echo "       branch, so drizzle thinks they're already applied. This would otherwise fail" >&2
  echo "       later as a control-plane 'internal error' when publishing a subgraph." >&2
  echo "       Reset the control-plane DB, then re-run make ei-demo:" >&2
  echo "         docker exec cosmo-dev-postgres-1 psql -U postgres -c \"DROP DATABASE IF EXISTS controlplane WITH (FORCE)\" -c \"CREATE DATABASE controlplane\"" >&2
  echo "       If keycloak then fails to start, the whole volume is stale; wipe it instead:" >&2
  echo "         make ei-demo-down && docker compose --file docker-compose.yml --profile dev down -v" >&2
  exit 1
}

# Proposals (hub's branch -> proposal -> registry -> feature-flag-rollout
# flow) are gated behind an enterprise billing plan and a namespace flag,
# neither set by `make seed`. Without this, hub's "Create on registry" call
# fails with a generic InternalServerError. See RUNBOOK.md.
echo "==> Enabling cosmo proposals (required for hub's proposal/rollout workflow)"
docker exec cosmo-dev-postgres-1 psql -U postgres -d controlplane -v ON_ERROR_STOP=1 -c "
  INSERT INTO public.organization_billing (id, organization_id, plan)
     SELECT gen_random_uuid(), id, 'enterprise'
     FROM public.organizations WHERE slug = 'wundergraph'
   ON CONFLICT (organization_id) DO UPDATE SET plan = 'enterprise';

  INSERT INTO public.namespace_config (namespace_id, enable_proposals)
     SELECT id, true FROM public.namespaces
     WHERE name = 'default'
       AND organization_id = (SELECT id FROM public.organizations WHERE slug = 'wundergraph')
   ON CONFLICT (namespace_id) DO UPDATE SET enable_proposals = true;
" || { echo "ERROR: could not enable proposals on the control plane database." >&2; exit 1; }

echo "==> Aligning the demo user with hub's keycloak identity"
# Its own small retry, not wrapped in cosmo-keycloak recovery: a hiccup
# here is about hub's API, not cosmo's keycloak. See RUNBOOK.md.
align_ok=""
for align_attempt in 1 2 3; do
  if ./scripts/ei-demo/align-hub-identity.sh; then
    align_ok=1
    break
  fi
  echo "align-hub-identity.sh attempt $align_attempt failed, retrying..." >&2
  sleep 2
done
if [ -z "$align_ok" ]; then
  echo "ERROR: could not align the demo user with hub's keycloak identity after 3 attempts." >&2
  exit 1
fi

# Demo graph provisioning below needs a live control plane, which the
# ei-demo start step doesn't bring up until after this script returns,
# so start it here if needed and leave it running; the start step detects
# that and won't start a second one.
echo "==> Control plane (needed to provision the demo graph)"
if nc -z 127.0.0.1 3001 2>/dev/null; then
  # An open port is not proof it's ours: a control plane left over from ordinary
  # cosmo work validates tokens against cosmo's keycloak instead of hub's, and
  # rejects every call hub makes. That surfaces only much later, as an empty
  # organization list on hub's login. See RUNBOOK.md.
  cp_kc_url="$(controlplane_kc_api_url)"
  if [ "$cp_kc_url" != "http://localhost:8090" ]; then
    echo "ERROR: port 3001 is taken, but not by this demo's control plane." >&2
    echo "       Its KC_API_URL is '${cp_kc_url:-not visible}', expected 'http://localhost:8090'." >&2
    echo "       It would reject hub's calls, so hub would offer 'Create organization'" >&2
    echo "       instead of the demo org. Stop it and re-run:" >&2
    echo "         kill \$(lsof -tiTCP:3001 -sTCP:LISTEN)" >&2
    # A dockerised control plane (docker-compose.full.yml publishes 3001) shows
    # no KC_API_URL here at all, since the value lives inside the container.
    echo "       If it runs in docker instead: docker compose --file docker-compose.full.yml down" >&2
    exit 1
  fi
  echo "Already running (verified it targets hub's keycloak)."
else
  echo "Starting control plane in the background..."
  NODE_BIN="$(./scripts/ei-demo/node-path.sh)" || exit 1
  # Hub's keycloak, passed as env vars rather than written into
  # controlplane/.env: the control plane needs it for the whole time it
  # runs (token validation), but the file itself stays untouched.
  (cd controlplane && PATH="$NODE_BIN:$PATH" KC_API_URL="http://localhost:8090" KC_FRONTEND_URL="http://localhost:8090" pnpm dev > /tmp/cosmo-controlplane-bootstrap.log 2>&1 & pid=$!; pidfile_entry "$pid" >> "$PID_FILE")
  wait_for_port 3001 60 0.5 || { echo "control plane did not start, see /tmp/cosmo-controlplane-bootstrap.log" >&2; exit 1; }
fi

# Every step above reports its own success, but nothing so far proves the one
# thing the browser-driven import actually depends on: that hub will list the
# demo org. Check the whole chain here, where a break still names its cause,
# rather than letting it surface as an opaque browser timeout at the last step.
echo "==> Verifying the demo identity resolves to the 'wundergraph' org"
verify_demo_identity_chain || {
  echo "ERROR: the demo identity chain is broken, see above; the schema import would" >&2
  echo "       fail later on hub's 'Create organization' screen." >&2
  exit 1
}

echo "==> Demo federated graph + subgraphs"
. ./scripts/configurations/local.sh
# Checked resource-by-resource, not behind one "graph exists" flag, a
# run that died mid-provisioning would otherwise skip the whole block.
EXISTING_GRAPHS="$(pnpm wgc federated-graph list --namespace default --json 2>/dev/null || echo '[]')"
if echo "$EXISTING_GRAPHS" | grep -q '"name":"mygraph"'; then
  echo "Federated graph 'mygraph' already exists."
else
  echo "Creating federated graph 'mygraph'..."
  pnpm wgc federated-graph create mygraph --namespace default --label-matcher team=A,team=B --routing-url http://localhost:3002/graphql
fi

EXISTING_SUBGRAPHS="$(pnpm wgc subgraph list --namespace default --json 2>/dev/null || echo '[]')"
create_subgraph_if_missing() {
  local name="$1"
  shift
  if echo "$EXISTING_SUBGRAPHS" | grep -q "\"name\":\"$name\""; then
    echo "Subgraph '$name' already exists."
  else
    echo "Creating subgraph '$name'..."
    pnpm wgc subgraph create "$name" "$@"
  fi
}
create_subgraph_if_missing employees --namespace default --label team=A --routing-url http://localhost:4001/graphql
create_subgraph_if_missing family --namespace default --label team=A --routing-url http://localhost:4002/graphql
create_subgraph_if_missing hobbies --namespace default --label team=B --routing-url http://localhost:4003/graphql
create_subgraph_if_missing products --namespace default --label team=B --routing-url http://localhost:4004/graphql
create_subgraph_if_missing availability --namespace default --label team=A --routing-url http://localhost:4007/graphql
create_subgraph_if_missing mood --namespace default --label team=B --routing-url http://localhost:4008/graphql
create_subgraph_if_missing employeeupdated --event-driven-graph --namespace default --label team=B

# Always runs (not gated behind the creation check above), publishing
# is safe to repeat.
echo "Publishing subgraph schemas..."
./scripts/update-demo.sh

echo "==> Router auth token"
# wgc can't fetch a token's plaintext back, so validity is checked by
# decoding its federated_graph_id claim against a fresh wgc id lookup.
# wgc's --json flag isn't honored on an empty result set (it prints a
# plain-text "No federated graphs found" instead, confirmed against the
# CLI's own source), mygraph was already created above, by this point, so
# that shouldn't happen here, but the parse degrading silently to "no
# match" either way would be indistinguishable from a real empty result.
CURRENT_GRAPH_JSON="$(pnpm wgc federated-graph list --namespace default --json 2>/dev/null | tail -1)"
case "$CURRENT_GRAPH_JSON" in
  \[*) ;;
  *)
    echo "WARNING: 'wgc federated-graph list --json' didn't return JSON; treating the router token as unverifiable and minting a fresh one." >&2
    CURRENT_GRAPH_JSON='[]'
    ;;
esac
CURRENT_GRAPH_ID="$(echo "$CURRENT_GRAPH_JSON" | python3 -c "
import json, sys
try:
    graphs = json.load(sys.stdin)
    print(next((g.get('id', '') for g in graphs if g.get('name') == 'mygraph'), ''))
except Exception:
    print('')
")"
EXISTING_TOKEN="$(grep '^GRAPH_API_TOKEN=' router/.env 2>/dev/null | cut -d= -f2-)"
TOKEN_GRAPH_ID=""
if [ -n "$EXISTING_TOKEN" ] && [ "$EXISTING_TOKEN" != "<generated_with_wgc>" ]; then
  TOKEN_GRAPH_ID="$(python3 -c "
import base64, json, sys
try:
    payload = sys.argv[1].split('.')[1]
    payload += '=' * (-len(payload) % 4)
    print(json.loads(base64.urlsafe_b64decode(payload)).get('federated_graph_id', ''))
except Exception:
    print('')
" "$EXISTING_TOKEN")" || true
fi

if [ -n "$TOKEN_GRAPH_ID" ] && [ -n "$CURRENT_GRAPH_ID" ] && [ "$TOKEN_GRAPH_ID" = "$CURRENT_GRAPH_ID" ]; then
  echo "Existing router token in router/.env is still valid for the current graph, reusing it."
else
  TOKEN_NAME="ei-demo-$(date +%s)"
  echo "Creating router token '$TOKEN_NAME' and writing it into router/.env..."
  # pnpm prints a preamble banner to stdout ahead of the real output; the
  # token itself is reliably the last line printed.
  TOKEN="$(pnpm wgc router token create "$TOKEN_NAME" --graph-name mygraph --namespace default --raw | tail -1)"
  [ -n "$TOKEN" ] || { echo "ERROR: router token creation failed (empty output from wgc)." >&2; exit 1; }
  if grep -q '^GRAPH_API_TOKEN=' router/.env; then
    # router/.env isn't exclusive to this demo, a replaced token could be a
    # developer's own, for other local router work. Fixed filename (not
    # timestamped) so repeated runs can't silently collide or accumulate.
    ROUTER_ENV_BACKUP="/tmp/ei-demo-router-env-backup.bak"
    if cp router/.env "$ROUTER_ENV_BACKUP" 2>/dev/null; then
      echo "Replacing an existing GRAPH_API_TOKEN in router/.env (prior file backed up to $ROUTER_ENV_BACKUP)."
    else
      echo "WARNING: could not back up router/.env before replacing its GRAPH_API_TOKEN; proceeding without a backup." >&2
    fi
    sed -i.bak "s#^GRAPH_API_TOKEN=.*#GRAPH_API_TOKEN=${TOKEN}#" router/.env
    rm -f router/.env.bak
  else
    echo "GRAPH_API_TOKEN=${TOKEN}" >> router/.env
  fi
fi

echo "==> Entity Intelligence-specific config (graphql-go-tools sibling, go.mod replace, demo.config.yaml)"
./scripts/ei-demo/setup-router-config.sh

echo "==> Importing the demo schema into hub"
# Hub has no password-login API, so schema import needs a real headless
# browser session (playwright, fetched on demand via npx since it's not
# a hub dependency). NODE_PATH has to be discovered and set explicitly
# for tsx to resolve it, npx's -p alone doesn't wire that up. See
# RUNBOOK.md.
if [ ! -d "$HUB_DIR" ]; then
  echo "ERROR: $HUB_DIR not found; cannot import the demo schema into hub." >&2
  exit 1
elif [ ! -f "$HUB_DIR/scripts/ei-demo/import-cosmo-schema.ts" ]; then
  echo "ERROR: $HUB_DIR/scripts/ei-demo/import-cosmo-schema.ts not found." >&2
  echo "       hub must be on $HUB_BRANCH (where this script lives); check out that branch, then re-run." >&2
  exit 1
else
  # 180s, not 60: on a fresh clone hub's frontend has to compile before it
  # answers, which is comfortably over a minute on a cold or slow machine. The
  # old message also told the reader to run `make all` and start the dev
  # servers, both of which this script already did above, so it sent them
  # after something that was never the problem.
  echo "Waiting for hub's frontend (3301) and backend (3305)..."
  for port in 3301 3305; do
    wait_for_port "$port" 180 1 || {
      echo "ERROR: hub's port $port never came up." >&2
      echo "       This script already ran 'make all' and started hub's dev servers, so the" >&2
      echo "       reason is in their output: /tmp/hub-dev.log" >&2
      echo "       A missing LIVEBLOCKS_SECRET_KEY is the usual cause for 3305 specifically." >&2
      exit 1
    }
  done

  npx --yes -p playwright@1.61.1 -p tsx@4.23.1 tsx --version >/tmp/ei-demo-npx-prefetch.log 2>&1 || {
    echo "ERROR: could not fetch playwright/tsx via npx." >&2
    cat /tmp/ei-demo-npx-prefetch.log >&2
    exit 1
  }
  NPX_CACHE="$(npm config get cache)/_npx"
  PW_DIR="$(find "$NPX_CACHE" -maxdepth 3 -type d -path '*/node_modules/playwright' 2>/dev/null | head -1)"
  if [ -z "$PW_DIR" ]; then
    echo "ERROR: could not locate playwright in npm's npx cache after installing it." >&2
    exit 1
  fi

  # Installing the playwright npm package does not download a browser binary
  # (no postinstall hook); chromium.launch() needs one fetched separately.
  npx --yes -p playwright@1.61.1 playwright install chromium >/tmp/ei-demo-playwright-install.log 2>&1 || {
    echo "ERROR: could not install playwright's chromium browser." >&2
    cat /tmp/ei-demo-playwright-install.log >&2
    exit 1
  }

  NODE_PATH="$(dirname "$PW_DIR")" npx --yes -p playwright@1.61.1 -p tsx@4.23.1 tsx "$HUB_DIR/scripts/ei-demo/import-cosmo-schema.ts"
fi

echo "==> Bootstrap complete. Run 'make ei-demo' to start the demo stack."
