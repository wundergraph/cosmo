#!/bin/bash
set -e

SUBGRAPHS="employees family hobbies products availability mood employeeupdated"

for subgraph in $SUBGRAPHS; do
  pnpm wgc subgraph publish $subgraph --namespace default --schema ../demo/pkg/subgraphs/$subgraph/subgraph/schema.graphqls
done
