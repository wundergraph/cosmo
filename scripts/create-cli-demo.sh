#!/usr/bin/env bash
set -e

# Create demo using the published CLI
# Create and publish a demo federated graph based on the subgraphs in the demo folder

. ./scripts/configurations/local.sh

# Check if wgc is available, install locally if not
if ! command -v wgc &> /dev/null; then
  echo "wgc not found, installing locally..."
  export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.npm-global}"
  export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
  mkdir -p "$NPM_CONFIG_PREFIX"
  npm install -g --prefix "$NPM_CONFIG_PREFIX" wgc@latest
fi

wgc federated-graph create mygraph --namespace default --label-matcher team=A,team=B --routing-url http://localhost:3002/graphql

wgc subgraph create employees --namespace default --label team=A --routing-url http://employees:4001/graphql
wgc subgraph create family --namespace default --label team=A --routing-url http://family:4002/graphql
wgc subgraph create hobbies --namespace default --label team=B --routing-url http://hobbies:4003/graphql
wgc subgraph create products --namespace default --label team=B --routing-url http://products:4004/graphql
wgc subgraph create availability --namespace default --label team=A --routing-url http://availability:4007/graphql
wgc subgraph create mood --namespace default --label team=B --routing-url http://mood:4008/graphql
wgc subgraph create employeeupdated --event-driven-graph --namespace default --label team=B

SUBGRAPHS="employees family hobbies products availability mood employeeupdated"

for subgraph in $SUBGRAPHS; do
  wgc subgraph publish $subgraph --namespace default --schema ./demo/pkg/subgraphs/$subgraph/subgraph/schema.graphqls
done
