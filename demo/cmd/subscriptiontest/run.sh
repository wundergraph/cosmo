#!/usr/bin/env sh
export CGO_ENABLED=0
export GOOS=linux
export GOARCH=amd64
go build --tags "static netgo" -o subscriptiontest main.go
docker run --rm -it --platform linux/amd64 -l subscriptiontest -v $(pwd)/subscriptiontest:/subscriptiontest alpine /subscriptiontest -instances=100 -host=host.docker.internal