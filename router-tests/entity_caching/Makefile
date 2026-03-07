.PHONY: all generate compose

all: generate compose

generate:
	cd subgraphs/items && go run github.com/99designs/gqlgen generate
	cd subgraphs/details && go run github.com/99designs/gqlgen generate
	cd subgraphs/inventory && go run github.com/99designs/gqlgen generate

compose:
	go run ./cmd/compose
	jq . testdata/config.json > testdata/config.json.tmp
	mv testdata/config.json.tmp testdata/config.json
