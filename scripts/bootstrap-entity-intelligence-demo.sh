#!/bin/bash
set -e

# Full "clean clone -> working Entity Intelligence demo" bootstrap.
#
# Mirrors cosmo's own `dev-setup` target (prerequisites, pnpm install,
# build, docker infra), minus `pnpm generate` / `make generate-go`: those
# regenerate protobuf/connect code from .proto files, which is only
# needed when a .proto file actually changed — the generated output is
# already committed (verified: connect/src/**/*_pb.ts and the .pb.go
# files are tracked in git), and running codegen anyway crashed on a
# genuinely clean machine (Node 25's experimental global `localStorage`
# breaks @typescript/vfs, a transitive codegen dependency — confirmed
# via an actual fresh-clone run, not a guess). Layers on top of that:
# DB migrate + seed, the demo federated graph + subgraphs + schema
# publish, a router auth token written into router/.env, and (via
# setup-entity-intelligence-demo.sh) the Entity-Intelligence-specific
# router config.
#
# Every step checks current state first and skips if already done, so
# this is safe to run repeatedly, including on a machine that's partway
# through setup.

cd "$(dirname "$0")/.."

echo "==> Prerequisites, install, build, docker infra (skipping codegen, see header)"
make prerequisites
pnpm install
make infra-up
pnpm -r run --filter '!studio' build
make build-plugins

# Must exist before migrate/seed: controlplane's own scripts (db-migrate.ts
# etc.) read DB_URL and friends straight out of controlplane/.env.
echo "==> .env files (controlplane, graphqlmetrics, router)"
[ -f controlplane/.env ] || cp controlplane/.env.example controlplane/.env
[ -f graphqlmetrics/.env ] || cp graphqlmetrics/.env.example graphqlmetrics/.env
[ -f router/.env ] || cp router/.env.example router/.env

echo "==> Waiting for postgres..."
for i in $(seq 1 60); do
  nc -z 127.0.0.1 5432 && break
  sleep 0.5
done
nc -z 127.0.0.1 5432 || { echo "postgres did not start" >&2; exit 1; }

# `make migrate` runs both db:migrate (postgres) and ch:migrate
# (ClickHouse) — ClickHouse is a separate docker service that typically
# cold-starts slower than postgres, so it needs its own wait here too.
echo "==> Waiting for ClickHouse..."
for i in $(seq 1 60); do
  nc -z 127.0.0.1 8123 && break
  sleep 0.5
done
nc -z 127.0.0.1 8123 || { echo "ClickHouse did not start" >&2; exit 1; }

echo "==> Database migrate"
make migrate

echo "==> Database seed (default local dev org/user)"
make seed

# Provisioning the demo graph below needs the platform API, i.e. a live
# control plane — which the `ei-demo` Makefile target doesn't start until
# after this script returns. Start it here if it isn't already running,
# and leave it running: the Makefile target checks for that and skips
# starting a second one.
echo "==> Control plane (needed to provision the demo graph)"
if nc -z 127.0.0.1 3001 2>/dev/null; then
  echo "Already running."
else
  echo "Starting control plane in the background..."
  (cd controlplane && pnpm dev > /tmp/cosmo-controlplane-bootstrap.log 2>&1 &)
  for i in $(seq 1 60); do
    nc -z 127.0.0.1 3001 && break
    sleep 0.5
  done
  nc -z 127.0.0.1 3001 || { echo "control plane did not start, see /tmp/cosmo-controlplane-bootstrap.log" >&2; exit 1; }
fi

echo "==> Demo federated graph + subgraphs"
. ./scripts/configurations/local.sh
# Each resource is checked individually, not gated behind one "does the
# graph exist" flag: if a prior run died after creating the graph but
# before all seven subgraphs existed, gating on the graph alone would
# see it, skip the whole block, and silently leave subgraphs missing.
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

# Publishing is safe to repeat (that's what update-demo.sh is for when a
# developer changes a demo schema), so this always runs rather than being
# gated behind the creation check above.
echo "Publishing subgraph schemas..."
./scripts/update-demo.sh

echo "==> Router auth token"
if grep -qE '^GRAPH_API_TOKEN=.{50,}' router/.env; then
  echo "router/.env already has a token."
else
  # A fixed token name would collide on retry if a prior run created the
  # token server-side but died before writing it to router/.env — tokens
  # are shown once and can't be re-fetched, so that run's token is gone
  # for good and "mytoken" would already be taken. A unique name per
  # attempt sidesteps the collision entirely; a stray orphaned token from
  # a dead run is harmless and can be cleaned up later.
  TOKEN_NAME="ei-demo-$(date +%s)"
  echo "Creating router token '$TOKEN_NAME' and writing it into router/.env..."
  # pnpm prints its own script-preamble banner to stdout ahead of the
  # command's real output (confirmed: two nested "> pkg wgc ..." lines),
  # so capturing the whole invocation would embed that banner in the
  # token. The token itself is reliably the last line printed.
  TOKEN="$(pnpm wgc router token create "$TOKEN_NAME" --graph-name mygraph --namespace default --raw | tail -1)"
  if grep -q '^GRAPH_API_TOKEN=' router/.env; then
    sed -i.bak "s#^GRAPH_API_TOKEN=.*#GRAPH_API_TOKEN=${TOKEN}#" router/.env
    rm -f router/.env.bak
  else
    echo "GRAPH_API_TOKEN=${TOKEN}" >> router/.env
  fi
fi

echo "==> Entity Intelligence-specific config (graphql-go-tools sibling, go.mod replace, demo.config.yaml)"
./scripts/setup-entity-intelligence-demo.sh

echo "==> Bootstrap complete. Run 'make ei-demo' to start the demo stack."
