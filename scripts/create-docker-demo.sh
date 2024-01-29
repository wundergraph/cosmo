#!/bin/bash

cd "../cli"

# Create and publish a demo federated graph based on the subgraphs in the demo folder

export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
export COSMO_API_URL=http://localhost:3001

pnpm wgc federated-graph create mygraph --namespace default --label-matcher team=A,team=B --routing-url http://localhost:3002/graphql

pnpm wgc subgraph create employees --namespace default --label team=A --routing-url http://employees:4001/graphql
pnpm wgc subgraph create family --namespace default --label team=A --routing-url http://family:4002/graphql
pnpm wgc subgraph create hobbies --namespace default --label team=B --routing-url http://hobbies:4003/graphql
pnpm wgc subgraph create products --namespace default --label team=B --routing-url http://products:4004/graphql

cd "../scripts"

./update-demo.sh

cd "../cli"

pnpm wgc router token create mytoken --graph-name mygraph --namespace default
