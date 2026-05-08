#!/bin/sh

set -eu

cd "$(dirname "$0")/.."
GOCACHE="${GOCACHE:-/tmp/cosmo-code-mode-go-build-cache}"
mkdir -p "$GOCACHE"

npx concurrently --kill-others \
  "GOCACHE=$GOCACHE PORT=4001 go run ./cmd/employees" \
  "GOCACHE=$GOCACHE PORT=4002 go run ./cmd/family" \
  "GOCACHE=$GOCACHE PORT=4003 go run ./cmd/hobbies" \
  "GOCACHE=$GOCACHE PORT=4004 go run ./cmd/products" \
  "GOCACHE=$GOCACHE PORT=4006 go run ./cmd/test1" \
  "GOCACHE=$GOCACHE PORT=4007 go run ./cmd/availability" \
  "GOCACHE=$GOCACHE PORT=4008 go run ./cmd/mood" \
  "GOCACHE=$GOCACHE PORT=4009 go run ./cmd/countries" \
  "GOCACHE=$GOCACHE PORT=4010 go run ./cmd/products_fg"
