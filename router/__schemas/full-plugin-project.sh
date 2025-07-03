#!/bin/bash

rm -rf cosmo

pnpx tsx --env-file ../../cli/.env ../../cli/src/index.ts router plugin init hello-world
