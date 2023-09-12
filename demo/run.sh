#!/bin/sh

set -ex

if test -z $OTEL_AUTH_TOKEN; then
    echo missing OTEL_AUTH_TOKEN
    exit 1
fi

./run_subgraphs.sh
