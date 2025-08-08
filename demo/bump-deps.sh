#!/usr/bin/env bash

GIT_REV=$(git show-ref main --heads -s)

echo "Updating dependencies to $GIT_REV"

go get "github.com/wundergraph/cosmo/router@${GIT_REV}"
go get "github.com/wundergraph/cosmo/router-tests@${GIT_REV}"
go mod tidy
