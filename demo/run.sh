#!/bin/sh

set -ex

#if test -z $OTEL_AUTH_TOKEN; then
#    echo missing OTEL_AUTH_TOKEN
#    exit 1
#fi

npx concurrently --kill-others \
    "cd employees && go run main.go" \
    "cd family && go run main.go" \
    "cd hobbies && go run main.go" \
    "cd products && go run main.go"
