#!/bin/sh

# This scripts generates the files require for running
# the library, which are then embedded by the Go compiler
# via embed

cd shim && pnpm i && pnpm exec tsup && cd -
cp -f shim/dist/index.global.js .
