#!/bin/bash
set -e

# Create and publish a demo federated graph based on the subgraphs in the demo folder

. ./scripts/configurations/kubernetes.sh

./scripts/create-cloud-demo.sh