#!/bin/sh

npx concurrently --kill-others \
    "cd cmd/employees && go run main.go" \
    "cd cmd/family && go run main.go" \
    "cd cmd/hobbies && go run main.go" \
    "cd cmd/products && go run main.go" \
    "cd cmd/availability && go run main.go" \
    "cd cmd/mood && go run main.go" \
    "cd cmd/test1 && go run main.go" \
    "cd cmd/products_fg && go run main.go"
