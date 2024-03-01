#!/bin/bash

# cd "../cli"

# pnpm wgc router compose -i ../demo/graph.yaml -o ../router-tests/testenv/testdata/config.json

npx --verbose --yes wgc@latest router compose -i ../demo/graph.yaml -o ../router-tests/testenv/testdata/config.json
jq . ../router-tests/testenv/testdata/config.json > ../router-tests/testenv/testdata/config.json.tmp
mv ../router-tests/testenv/testdata/config.json.tmp ../router-tests/testenv/testdata/config.json
