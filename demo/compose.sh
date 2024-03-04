#!/bin/bash

cd "../cli"

pnpm wgc router compose -i ../demo/graph.yaml -o ../demo/config.json

#npx wgc@latest router compose -i graph.yaml -o config.json
