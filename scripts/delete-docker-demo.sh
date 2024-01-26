#!/bin/bash

cd "../cli"

# Delete the demo

export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
export COSMO_API_URL=http://localhost:3001

pnpm wgc federated-graph delete mygraph --namespace default -f
pnpm wgc subgraph delete employees --namespace default -f
pnpm wgc subgraph delete family --namespace default -f
pnpm wgc subgraph delete hobbies --namespace default -f
pnpm wgc subgraph delete products --namespace default -f
