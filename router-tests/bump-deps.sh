#!/bin/bash

GIT_REV=$(git rev-parse --short HEAD)

echo "Updating dependencies to $GIT_REV"

go get "github.com/wundergraph/cosmo/router@${GIT_REV}"
go get "github.com/wundergraph/cosmo/demo@${GIT_REV}"
go mod tidy
cd .. && go work sync
