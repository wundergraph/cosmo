#!/usr/bin/env bash

# Build the subscriptiontest binary and run a workload of 100 subscriptions
# Due to resource constraints on Mac, we need to run the workload in a container to get more ports.

export CGO_ENABLED=0
export GOOS=linux
export GOARCH=amd64

go build --tags "static netgo" -o subscriptiontest main.go && chmod +x subscriptiontest

if [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
   ./subscriptiontest -instances=100
else
  docker run --rm -it --platform linux/amd64 -l subscriptiontest -v $(pwd)/subscriptiontest:/subscriptiontest alpine /subscriptiontest -instances=100 -host=host.docker.internal
fi