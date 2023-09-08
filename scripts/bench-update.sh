#!/bin/bash

cd "../cli"

export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
export COSMO_API_URL=http://localhost:3001

pnpm wgc subgraph publish bench-accounts --schema  ../../benchmark-federation/subgraphs/services/accounts/schema.graphql
pnpm wgc subgraph publish bench-reviews --schema  ../../benchmark-federation/subgraphs/services/reviews/schema.graphql
pnpm wgc subgraph publish bench-products --schema  ../../benchmark-federation/subgraphs/services/products/schema.graphql
pnpm wgc subgraph publish bench-inventory --schema  ../../benchmark-federation/subgraphs/services/inventory/schema.graphql
