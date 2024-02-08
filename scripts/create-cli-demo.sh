#!/bin/bash

# Create demo using the published CLI
# Create and publish a demo federated graph based on the subgraphs in the demo folder

export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
export COSMO_API_URL=http://localhost:3001
export KC_API_URL=http://localhost:8080

npm install -g wgc@latest

wgc federated-graph create mygraph --namespace default --label-matcher team=A,team=B --routing-url http://localhost:3002/graphql

wgc subgraph create employees --namespace default --label team=A --routing-url http://employees:4001/graphql
wgc subgraph create family --namespace default --label team=A --routing-url http://family:4002/graphql
wgc subgraph create hobbies --namespace default --label team=B --routing-url http://hobbies:4003/graphql
wgc subgraph create products --namespace default --label team=B --routing-url http://products:4004/graphql

SUBGRAPHS="employees family hobbies products"

for subgraph in $SUBGRAPHS; do
  wgc subgraph publish $subgraph --namespace default --schema ../demo/pkg/subgraphs/$subgraph/subgraph/schema.graphqls
done
