#!/bin/bash
set -e

SUBGRAPHS="employees family hobbies products employeeupdated"

for subgraph in $SUBGRAPHS; do
  pnpm wgc subgraph publish $subgraph --namespace default --schema ./demo/pkg/subgraphs/$subgraph/subgraph/schema.graphqls
done
