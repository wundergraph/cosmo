#!/bin/bash

#pnpm --reporter=silent wgc router compose -i ../router/_schemas/issue-167/graph.yaml > ../router/_schemas/issue-167/config.json
#pnpm wgc router compose -i ../router/__schemas/graph.yaml -o ../router/__schemas/config.json

pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts plugin init foo -d ../plugins
pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts plugin build ../plugins/foo --debug
pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router compose -i graph.yaml -o config.json
