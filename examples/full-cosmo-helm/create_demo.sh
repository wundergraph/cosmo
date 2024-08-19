#!/bin/bash
set -e

# Install WunderGraph CLI
npm install -g wgc@latest

# Load the right configuration for Kubernetes Cluster
. ../../scripts/configurations/kubernetes.sh

# Create and publish the subgraphs
wgc namespace create development
wgc federated-graph create mygraph --namespace development --routing-url "http://router.wundergraph.local/graphql"
wgc subgraph publish employees --namespace development --routing-url "https://employees-api.fly.dev/graphql" --schema ../../demo/pkg/subgraphs/employees/subgraph/schema.graphqls
wgc subgraph publish family --namespace development --routing-url "https://family-api.fly.dev/graphql" --schema ../../demo/pkg/subgraphs/family/subgraph/schema.graphqls
wgc subgraph publish hobbies --namespace development --routing-url "https://hobbies-api.fly.dev/graphql" --schema ../../demo/pkg/subgraphs/hobbies/subgraph/schema.graphqls
wgc subgraph publish products --namespace development --routing-url "https://product-api.fly.dev/graphql" --schema ../../demo/pkg/subgraphs/products/subgraph/schema.graphqls

GRAPH_API_TOKEN=$(wgc router token create mytoken --graph-name mygraph --namespace development --raw)

helm upgrade cosmo oci://ghcr.io/wundergraph/cosmo/helm-charts/cosmo --version 0.8.0 \
  --set global.router.enabled=true \
  --set router.configuration.graphApiToken="$GRAPH_API_TOKEN"