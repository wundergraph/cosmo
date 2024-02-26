#!/bin/bash
set -eu

fly secrets set -a product-api GRAPH_API_TOKEN="$GRAPH_API_TOKEN"
fly deploy -a employees-api GRAPH_API_TOKEN="$GRAPH_API_TOKEN"
fly deploy -a family-api GRAPH_API_TOKEN="$GRAPH_API_TOKEN"
fly deploy -a hobbies-api GRAPH_API_TOKEN="$GRAPH_API_TOKEN"