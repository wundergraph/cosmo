#!/bin/sh

set -eu

cd "$(dirname "$0")/.."
GOCACHE="${GOCACHE:-/tmp/cosmo-code-mode-go-build-cache}"
mkdir -p "$GOCACHE"

# cmd/all bundles every subgraph into a single process with NATS pubsub
# wired up. Required for mood/availability mutations to work — the per-
# subgraph cmd/<name> binaries pass nil for the NATS adapter and fail at
# runtime with "no nats pubsub default provider found".
GOCACHE="$GOCACHE" go run ./cmd/all \
  -employees=4001 -family=4002 -hobbies=4003 -products=4004 \
  -test1=4006 -availability=4007 -mood=4008 -countries=4009 -products_fg=4010
