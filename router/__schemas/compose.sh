#!/bin/bash

# Commented commands for reference
#pnpm --reporter=silent wgc router compose -i ../router/_schemas/issue-167/graph.yaml > ../router/_schemas/issue-167/config.json
#pnpm wgc router compose -i ../router/__schemas/graph.yaml -o ../router/__schemas/config.json

echo "Step 1: Cleaning up previous plugins directory..."
rm -rf ../plugins

echo "Step 2: Initializing 'foo' plugin..."
pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin init foo -d ../plugins

echo "Step 3: Building 'foo' plugin with debug option..."
pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin build ../plugins/foo --debug

echo "Step 4: Composing router from graph.yaml to config.json..."
pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router compose -i graph.yaml -o config.json

echo "Step 5: Run plugin test..."
pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin test ../plugins/foo

echo "All steps completed successfully!"
