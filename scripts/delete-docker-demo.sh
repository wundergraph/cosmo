#!/bin/bash

cd "../cli"

# Delete the demo

export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
export COSMO_API_URL=http://localhost:3001

pnpm wgc federated-graph delete production -f
pnpm wgc subgraph delete employees -f
pnpm wgc subgraph delete family -f
pnpm wgc subgraph delete hobbies -f
pnpm wgc subgraph delete products -f
