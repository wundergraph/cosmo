#!/bin/bash

cd "../../cli"

#pnpm --reporter=silent wgc router compose -i ../router/_schemas/issue-167/graph.yaml > ../router/_schemas/issue-167/config.json
#pnpm wgc router compose -i ../router/__schemas/graph.yaml -o ../router/__schemas/config.json
pnpm wgc router compose -i ../router/__schemas/graph.yaml -o ../router/__schemas/config.json
