#!/usr/bin/env bash
set -e

# Create and publish a demo federated graph based on the subgraphs in the demo folder

pnpm wgc federated-graph create mygraph --namespace default --label-matcher team=A,team=B --routing-url https://demo-router.fly.dev/graphql

pnpm wgc subgraph create employees --namespace default --label team=A --routing-url https://employees-api.fly.dev/graphql
pnpm wgc subgraph create family --namespace default --label team=A --routing-url https://family-api.fly.dev/graphql
pnpm wgc subgraph create hobbies --namespace default --label team=B --routing-url https://hobbies-api.fly.dev/graphql
pnpm wgc subgraph create products --namespace default --label team=B --routing-url https://product-api.fly.dev/graphql
pnpm wgc subgraph create availability --namespace default --label team=A --routing-url https://availability-api.fly.dev/
pnpm wgc subgraph create mood --namespace default --label team=B --routing-url https://mood-api.fly.dev/
pnpm wgc subgraph create employeeupdated --event-driven-graph --namespace default --label team=B

./scripts/update-demo.sh

pnpm wgc router token create mytoken --graph-name mygraph --namespace default
