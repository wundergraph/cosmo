#!/bin/bash

# Create demo using the published CLI
# Create and publish a demo federated graph based on the subgraphs in the demo folder

export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
export COSMO_API_URL=http://localhost:3001
export KC_API_URL=http://localhost:8080

npm install -g wgc

wgc federated-graph create production --label-matcher team=A,team=B --label-matcher env=production --routing-url http://localhost:3002/graphql

wgc subgraph create employees --label team=A env=production --routing-url http://employees:4001/graphql
wgc subgraph create family --label team=A env=production --routing-url http://family:4002/graphql
wgc subgraph create hobbies --label team=B env=production --routing-url http://hobbies:4003/graphql
wgc subgraph create products --label team=B env=production --routing-url http://products:4004/graphql

wgc subgraph publish employees --schema ../demo/employees/subgraph/schema.graphqls
wgc subgraph publish family --schema ../demo/family/subgraph/schema.graphqls
wgc subgraph publish hobbies --schema ../demo/hobbies/subgraph/schema.graphqls
wgc subgraph publish products --schema ../demo/products/subgraph/schema.graphqls

wgc router token create mytoken --graph-name production