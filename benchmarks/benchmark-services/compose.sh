#!/bin/bash

cd "../cli"

pnpm wgc router compose -i ../benchmark-services/graph.cluster.yaml -o ../benchmark-services/config.json

#npx wgc@latest router compose -i graph.yaml -o config.json
