#!/bin/bash

rm -rf ../plugins

pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin init hello-world --only-plugin -d ../

pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin build ../plugins/hello-world --debug

pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router compose -i graph.yaml -o config.json

pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin test ../plugins/hello-world
