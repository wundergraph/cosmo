#!/bin/bash
set -e

cd "../cli"

. ./scripts/configurations/local.sh

pnpm wgc subgraph publish bench-accounts --schema  ../../benchmark-federation/subgraphs/services/accounts/schema.graphql
pnpm wgc subgraph publish bench-reviews --schema  ../../benchmark-federation/subgraphs/services/reviews/schema.graphql
pnpm wgc subgraph publish bench-products --schema  ../../benchmark-federation/subgraphs/services/products/schema.graphql
pnpm wgc subgraph publish bench-inventory --schema  ../../benchmark-federation/subgraphs/services/inventory/schema.graphql
