#!/bin/bash

# js composition

## using source code

echo "Generating config using 'wgc router compose'"
cd "../cli" || exit
pnpm wgc router compose -i ../demo/graph-with-plugin.yaml -o ../router-tests/testenv/testdata/configWithPlugins.json
pnpm wgc router compose -i ../demo/graph-with-standalone.yaml -o ../router-tests/testenv/testdata/configWithGRPC.json

## using npm package

#npx --verbose --yes wgc@latest router compose -i ../demo/graph.yaml -o ../router-tests/testenv/testdata/config.json

# go composition wrapper

# Can't use go wrapper because feature-graphs is not implemented in go yet
#echo "Generating config using go wrapper"
#go run ../demo/cmd/generateconfig/main.go

# format test config

echo "Formatting config"
jq . ../router-tests/testenv/testdata/configWithPlugins.json > ../router-tests/testenv/testdata/configWithPlugins.json.tmp
mv ../router-tests/testenv/testdata/configWithPlugins.json.tmp ../router-tests/testenv/testdata/configWithPlugins.json

jq . ../router-tests/testenv/testdata/configWithGRPC.json > ../router-tests/testenv/testdata/configWithGRPC.json.tmp
mv ../router-tests/testenv/testdata/configWithGRPC.json.tmp ../router-tests/testenv/testdata/configWithGRPC.json
