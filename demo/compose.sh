#!/bin/bash

pnpx tsx --env-file ../cli/.env ../cli/src/index.ts router compose -i graph.yaml -o config.json
