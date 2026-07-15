#!/bin/bash
set -e

# Full "clean clone -> working Entity Intelligence demo" bootstrap.
#
# Reuses cosmo's own `dev-setup` target (prerequisites, pnpm install,
# codegen, build, docker infra) as the base, since it's the project's own
# tested bootstrap path, rather than guessing at a smaller subset. Layers
# on everything dev-setup doesn't cover: DB migrate + seed, the demo
# federated graph + subgraphs + schema publish, a router auth token
# written into router/.env, and (via setup-entity-intelligence-demo.sh)
# the Entity-Intelligence-specific router config.
#
# Every step checks current state first and skips if already done, so
# this is safe to run repeatedly, including on a machine that's partway
# through setup.

cd "$(dirname "$0")/.."

echo "==> make dev-setup (prerequisites, install, codegen, build, docker infra)"
make dev-setup

echo "==> Waiting for postgres..."
for i in $(seq 1 60); do
  nc -z 127.0.0.1 5432 && break
  sleep 0.5
done
nc -z 127.0.0.1 5432 || { echo "postgres did not start" >&2; exit 1; }

echo "==> Database migrate"
make migrate

echo "==> Database seed (default local dev org/user)"
make seed

echo "==> .env files (controlplane, graphqlmetrics)"
[ -f controlplane/.env ] || cp controlplane/.env.example controlplane/.env
[ -f graphqlmetrics/.env ] || cp graphqlmetrics/.env.example graphqlmetrics/.env
[ -f router/.env ] || cp router/.env.example router/.env

echo "==> Demo federated graph + subgraphs"
. ./scripts/configurations/local.sh
if pnpm wgc federated-graph list --namespace default --json 2>/dev/null | grep -q '"name":"mygraph"'; then
  echo "Federated graph 'mygraph' already exists, skipping creation."
else
  echo "Creating federated graph, subgraphs, and publishing schemas..."
  pnpm wgc federated-graph create mygraph --namespace default --label-matcher team=A,team=B --routing-url http://localhost:3002/graphql
  pnpm wgc subgraph create employees --namespace default --label team=A --routing-url http://localhost:4001/graphql
  pnpm wgc subgraph create family --namespace default --label team=A --routing-url http://localhost:4002/graphql
  pnpm wgc subgraph create hobbies --namespace default --label team=B --routing-url http://localhost:4003/graphql
  pnpm wgc subgraph create products --namespace default --label team=B --routing-url http://localhost:4004/graphql
  pnpm wgc subgraph create availability --namespace default --label team=A --routing-url http://localhost:4007/graphql
  pnpm wgc subgraph create mood --namespace default --label team=B --routing-url http://localhost:4008/graphql
  pnpm wgc subgraph create employeeupdated --event-driven-graph --namespace default --label team=B
  ./scripts/update-demo.sh
fi

echo "==> Router auth token"
if grep -qE '^GRAPH_API_TOKEN=.{50,}' router/.env; then
  echo "router/.env already has a token."
else
  echo "Creating router token and writing it into router/.env..."
  TOKEN="$(pnpm wgc router token create mytoken --graph-name mygraph --namespace default --raw)"
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
