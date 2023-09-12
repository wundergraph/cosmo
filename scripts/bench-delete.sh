#!/bin/bash

cd "../cli"

# Delete the demo

export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
export COSMO_API_URL=http://localhost:3001

pnpm wgc federated-graph delete bench -f
pnpm wgc subgraph delete bench-accounts -f
pnpm wgc subgraph delete bench-reviews -f
pnpm wgc subgraph delete bench-products -f
pnpm wgc subgraph delete bench-inventory -f
