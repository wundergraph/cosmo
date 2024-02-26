#!/bin/bash
set -eu

fly secrets set -a product-api GRAPH_API_TOKEN="$GRAPH_API_TOKEN"
fly secrets set -a employees-api GRAPH_API_TOKEN="$GRAPH_API_TOKEN"
fly secrets set -a family-api GRAPH_API_TOKEN="$GRAPH_API_TOKEN"
fly secrets set -a hobbies-api GRAPH_API_TOKEN="$GRAPH_API_TOKEN"