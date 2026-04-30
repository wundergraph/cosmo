#!/bin/bash
set -e

# Install WunderGraph CLI
npm install -g wgc@latest

# Download the latest router binary into the current directory
if [ ! -f router ]; then
    wgc router download-binary -o .
fi

# Start the demo projects subgraph in the background. It serves the
# Connect handler on :4011 over H2C, which accepts Connect, gRPC, and
# gRPC-Web from the same endpoint.
(
    cd ../../demo/pkg/subgraphs/projects
    go run ./cmd/service
) &
PROJECTS_PID=$!
trap 'kill $PROJECTS_PID 2>/dev/null || true' EXIT

# Compose the federated schema from graph.yaml.
wgc router compose -i graph.yaml -o config.json

# Start the router. The grpc_protocol.default_protocol=connectrpc setting
# in config.yaml routes traffic to the projects subgraph over HTTP/1.1.
./router
