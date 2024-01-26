#!/bin/bash

cd "../cli"

export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
export COSMO_API_URL=http://localhost:3001

SUBGRAPHS="employees family hobbies products"

for subgraph in $SUBGRAPHS; do
  pnpm wgc subgraph publish $subgraph --namespace default --schema ../demo/pkg/subgraphs/$subgraph/subgraph/schema.graphqls
done
