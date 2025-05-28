#!/bin/bash

# export COSMO_API_KEY=cosmo_669b576aaadc10ee1ae81d9193425705
# export COSMO_API_URL=http://localhost:3001


#pnpm --reporter=silent wgc router compose -i ../router/_schemas/issue-167/graph.yaml > ../router/_schemas/issue-167/config.json
#pnpm wgc router compose -i ../router/__schemas/graph.yaml -o ../router/__schemas/config.json
pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router compose -i graph.yaml -o config.json
