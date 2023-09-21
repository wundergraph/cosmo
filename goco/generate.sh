#!/bin/sh

# This scripts generates the files require for running
# the library, which are then embedded by the Go compiler
# via embed

rm -fr node_modules

cd shim && pnpm i && pnpm exec tsup && cd -

mkdir -p node_modules/__composition/dist
cp shim/dist/index.js node_modules/__composition/dist
cp shim/package.json node_modules/__composition

mkdir -p node_modules/events
cp shim/node_modules/events/package.json shim/node_modules/events/events.js node_modules/events
