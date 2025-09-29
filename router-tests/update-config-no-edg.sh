#!/bin/bash

# js composition

## using source code

echo "Generating config using 'wgc router compose'"
pnpx tsx --env-file ../cli/.env ../cli/src/index.ts router compose -i ../demo/graph-no-edg.yaml -o ../router-tests/testenv/testdata/config.json

## using npm package

#npx --verbose --yes wgc@latest router compose -i ../demo/graph.yaml -o ../router-tests/testenv/testdata/config.json

# go composition wrapper

# Can't use go wrapper because feature-graphs is not implemented in go yet
#echo "Generating config using go wrapper"
#go run ../demo/cmd/generateconfig/main.go

# format test config

echo "Formatting config"
jq . ../router-tests/testenv/testdata/config.json > ../router-tests/testenv/testdata/config.json.tmp
mv ../router-tests/testenv/testdata/config.json.tmp ../router-tests/testenv/testdata/config.json
