#!/bin/bash

set -e 

# js composition

## using source code

echo "Generating config using 'wgc router compose'"
cd "../cli" || exit
pnpx tsx ../cli/src/index.ts router compose -i ../demo/graph.yaml -o ../router-tests/testenv/testdata/configWithEdfs.json

## using npm package

#npx --verbose --yes wgc@latest router compose -i ../demo/graph.yaml -o ../router-tests/testenv/testdata/config.json

# format test config

echo "Formatting config"
jq . ../router-tests/testenv/testdata/configWithEdfs.json > ../router-tests/testenv/testdata/configWithEdfs.json.tmp
mv ../router-tests/testenv/testdata/configWithEdfs.json.tmp ../router-tests/testenv/testdata/configWithEdfs.json
