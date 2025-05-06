#!/bin/bash
set -e

# Install WunderGraph CLI
npm install -g wgc@latest

# Download the latest router binary
if [ ! -f router ]; then
    wgc router download-binary -o .
fi

# Compose the schema
wgc router compose -i graph.yaml -o config.json

# Start the router
./router