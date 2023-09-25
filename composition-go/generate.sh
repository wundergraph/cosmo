#!/bin/sh

# This scripts generates the files require for running
# the library, which are then embedded by the Go compiler
# via embed

set -e

pnpm --filter='@wundergraph/composition' build
pnpm --filter='@wundergraph/composition-shim' install
pnpm --filter='@wundergraph/composition-shim' build
cp -f shim/dist/index.global.js .
