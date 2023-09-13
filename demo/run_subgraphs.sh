#!/bin/sh

npx concurrently --kill-others \
    "cd employees && go run main.go" \
    "cd family && go run main.go" \
    "cd hobbies && go run main.go" \
    "cd products && go run main.go"
