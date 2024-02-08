#!/bin/bash
set -e

# Create and publish a demo federated graph based on the subgraphs in the demo folder

. ./scripts/configurations/local.sh

pnpm wgc federated-graph create bench --label-matcher team=Bench --routing-url http://localhost:3003/graphql

pnpm wgc subgraph create bench-accounts --label team=Bench --routing-url http://localhost:4001/graphql
pnpm wgc subgraph create bench-reviews --label team=Bench --routing-url http://localhost:4002/graphql
pnpm wgc subgraph create bench-products --label team=Bench --routing-url http://localhost:4003/graphql
pnpm wgc subgraph create bench-inventory --label team=Bench --routing-url http://localhost:4004/graphql

./scripts/bench-update.sh

pnpm wgc federated-graph create-token bench --name mytoken
