#!/bin/bash

# Commented commands for reference
#pnpm --reporter=silent wgc router compose -i ../router/_schemas/issue-167/graph.yaml > ../router/_schemas/issue-167/config.json
#pnpm wgc router compose -i ../router/__schemas/graph.yaml -o ../router/__schemas/config.json

echo "Step 1: Cleaning up previous plugins directory..."
rm -rf ../plugins

echo "Step 2: Initializing 'hello-world' plugin..."
pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin init hello-world -d ../plugins

echo "Step 3: Building 'foo' plugin with debug option..."
pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin build ../plugins/hello-world --debug

echo "Step 4: Composing router from graph.yaml to config.json..."
pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router compose -i graph.yaml -o config.json

echo "Step 5: Run plugin test..."
pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin test ../plugins/hello-world

echo "All steps completed successfully!"
