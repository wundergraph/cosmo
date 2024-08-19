#!/bin/bash
set -e

. ../../scripts/configurations/kubernetes.sh

pnpm wgc namespace delete development -f
pnpm wgc router token delete mytoken -g mygraph -f