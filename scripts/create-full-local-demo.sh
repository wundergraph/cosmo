#!/bin/bash
set -e

###################################################################################################################
# This script creates a full local demo with a federated graph and subgraphs deployed to two different namespaces
# Demonstrates how to separate development and production environments
###################################################################################################################

###########################################
# 1. Create development namespace
###########################################

wgc namespace create dev

# 2. Create and publish a demo federated graph based on the subgraphs in the demo folder
wgc federated-graph create mygraph -n dev --routing-url http://localhost:3002/graphql

# 3. Create subgraphs for development-demo
wgc subgraph publish employees -n dev --routing-url https://employees-api.fly.dev/graphql --schema ./demo/pkg/subgraphs/employees/subgraph/schema.graphqls
wgc subgraph publish family -n dev --routing-url https://family-api.fly.dev/graphql --schema ./demo/pkg/subgraphs/family/subgraph/schema.graphqls
wgc subgraph publish hobbies -n dev --routing-url https://hobbies-api.fly.dev/graphql --schema ./demo/pkg/subgraphs/hobbies/subgraph/schema.graphqls
wgc subgraph publish products -n dev --routing-url https://product-api.fly.dev/graphql --schema ./demo/pkg/subgraphs/products/subgraph/schema.graphqls

# 4. Create a router token for development federated graph

wgc router token create test -n dev -g mygraph

# Finally, run the development router with the token

###########################################
# 1. Create production namespace
###########################################

wgc namespace create prod

# 2. Create and publish a demo federated graph based on the subgraphs in the demo folder
wgc federated-graph create mygraph -n prod --routing-url http://localhost:3003/graphql

# 3. Create subgraphs for prod
wgc subgraph publish employees -n prod --routing-url https://employees-api.fly.dev/graphql --schema ./demo/pkg/subgraphs/employees/subgraph/schema.graphqls
wgc subgraph publish family -n prod --routing-url https://family-api.fly.dev/graphql --schema ./demo/pkg/subgraphs/family/subgraph/schema.graphqls
wgc subgraph publish hobbies -n prod --routing-url https://hobbies-api.fly.dev/graphql --schema ./demo/pkg/subgraphs/hobbies/subgraph/schema.graphqls
wgc subgraph publish products -n prod --routing-url https://product-api.fly.dev/graphql --schema ./demo/pkg/subgraphs/products/subgraph/schema.graphqls

# 4. Create a router token for prod federated graph

wgc router token create test -n prod -g mygraph

# Finally, run the production router with the token

###########################################
# Run a schema check against the updated schema
###########################################

# wgc subgraph check family -n prod --schema ./demo/pkg/subgraphs/family/subgraph/schema.graphqls
# wgc subgraph publish family -n prod --schema ./demo/pkg/subgraphs/family/subgraph/schema.graphqls