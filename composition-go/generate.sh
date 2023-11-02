#!/bin/sh

# This scripts generates the files require for running
# the library, which are then embedded by the Go compiler
# via embed

set -e

pnpm generate
pnpm --filter='@wundergraph/composition' --filter='@wundergraph/cosmo-shared' build
pnpm --filter='@wundergraph/composition-shim' install
pnpm --filter='@wundergraph/composition-shim' build
cp -f shim/dist/index.global.js .
