#!/bin/bash

# js composition

## using source code

# cd "../cli"
# pnpm wgc router compose -i ../demo/graph.yaml -o ../router-tests/testenv/testdata/config.json

## using npm package

#npx --verbose --yes wgc@latest router compose -i ../demo/graph.yaml -o ../router-tests/testenv/testdata/config.json

# go composition wrapper

go run ../demo/cmd/generateconfig/main.go

# format test config

jq . ../router-tests/testenv/testdata/config.json > ../router-tests/testenv/testdata/config.json.tmp
mv ../router-tests/testenv/testdata/config.json.tmp ../router-tests/testenv/testdata/config.json
