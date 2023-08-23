#!/bin/bash

cd "../cli"

export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
export COSMO_API_URL=http://localhost:3001

pnpm wgc subgraph publish employees --schema ../demo/employees/subgraph/schema.graphqls
pnpm wgc subgraph publish family --schema ../demo/family/subgraph/schema.graphqls
pnpm wgc subgraph publish hobbies --schema ../demo/hobbies/subgraph/schema.graphqls
pnpm wgc subgraph publish products --schema ../demo/products/subgraph/schema.graphqls