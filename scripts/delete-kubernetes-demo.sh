#!/bin/bash
set -e

# Create and publish a demo federated graph based on the subgraphs in the demo folder

. ./scripts/configurations/kubernetes.sh

pnpm wgc federated-graph delete mygraph --namespace default -f
pnpm wgc subgraph delete employees --namespace default -f
pnpm wgc subgraph delete family --namespace default -f
pnpm wgc subgraph delete hobbies --namespace default -f
pnpm wgc subgraph delete products --namespace default -f
pnpm wgc router token delete mytoken -g mygraph -f