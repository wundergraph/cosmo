#!/bin/sh

# This scripts generates the files require for running
# the library, which are then embedded by the Go compiler
# via embed

rm -fr node_modules

cd shim && pnpm i && pnpm exec tsup && cd -
cp shim/dist/index.global.js .
