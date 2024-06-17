#!/bin/bash
set -e

# Create and publish a demo federated graph based on the subgraphs in the demo folder

. ./scripts/configurations/local.sh

pnpm wgc federated-graph create mygraph --namespace default --label-matcher team=A,team=B --routing-url http://localhost:3002/graphql

pnpm wgc subgraph create employees --namespace default --label team=A --routing-url http://localhost:4001/graphql
pnpm wgc subgraph create family --namespace default --label team=A --routing-url http://localhost:4002/graphql
pnpm wgc subgraph create hobbies --namespace default --label team=B --routing-url http://localhost:4003/graphql
pnpm wgc subgraph create products --namespace default --label team=B --routing-url http://localhost:4004/graphql
pnpm wgc subgraph create employeeupdated --namespace default --label team=B --event-driven-graph
pnpm wgc contract create mygraph-external --source mygraph -r http://localhost:3003/graphql --exclude internal
pnpm wgc subgraph create -edg employeeupdated --namespace default --label team=B

./scripts/update-demo.sh

pnpm wgc router token create mytoken --graph-name mygraph --namespace default

# Optionally
# pnpm wgc router token create myContractToken --graph-name mygraph-external --namespace default
