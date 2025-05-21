#!/bin/bash

# Commented commands for reference
#pnpm --reporter=silent wgc router compose -i ../router/_schemas/issue-167/graph.yaml > ../router/_schemas/issue-167/config.json
#pnpm wgc router compose -i ../router/__schemas/graph.yaml -o ../router/__schemas/config.json

rm -rf ../plugins

pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin init hello-world --only-plugin -d ../

pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin build ../plugins/hello-world --debug

pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router compose -i graph.yaml -o config.json

pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin test ../plugins/hello-world
