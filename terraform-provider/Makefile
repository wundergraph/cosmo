default: testacc

# Run acceptance tests
.PHONY: testacc
testacc:
	TF_ACC=1 go test ./... -v $(TESTARGS) -timeout 120m

generate:
	go generate ./...
	terraform fmt -recursive ./examples/

install:
	go generate

tidy:
	go mod tidy

test: tidy generate testacc
