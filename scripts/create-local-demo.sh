#!/bin/bash

cd "../cli"

# Create and publish a demo federated graph based on the subgraphs in the demo folder

export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
export COSMO_API_URL=http://localhost:3001

pnpm wgc federated-graph create production --label-matcher team=A,team=B --label-matcher env=production --routing-url http://localhost:3002/graphql

pnpm wgc subgraph create employees --label team=A env=production --routing-url http://localhost:4001/graphql
pnpm wgc subgraph create family --label team=A env=production --routing-url http://localhost:4002/graphql
pnpm wgc subgraph create hobbies --label team=B env=production --routing-url http://localhost:4003/graphql
pnpm wgc subgraph create products --label team=B env=production --routing-url http://localhost:4004/graphql

sh ../scripts/update-local-demo.sh

pnpm wgc federated-graph create-token production --name mytoken
