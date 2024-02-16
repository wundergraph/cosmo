#!/bin/bash
set -e

# Delete the demo

. ./scripts/configurations/local.sh

pnpm wgc federated-graph delete mygraph --namespace default -f
pnpm wgc subgraph delete employees --namespace default -f
pnpm wgc subgraph delete family --namespace default -f
pnpm wgc subgraph delete hobbies --namespace default -f
pnpm wgc subgraph delete products --namespace default -f
