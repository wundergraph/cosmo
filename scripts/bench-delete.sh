#!/bin/bash
set -e

# Delete the demo

. ./scripts/configurations/local.sh

pnpm wgc federated-graph delete bench -f
pnpm wgc subgraph delete bench-accounts -f
pnpm wgc subgraph delete bench-reviews -f
pnpm wgc subgraph delete bench-products -f
pnpm wgc subgraph delete bench-inventory -f
