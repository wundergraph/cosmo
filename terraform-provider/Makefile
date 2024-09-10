NAMESPACE						 = wundergraph
NAME							 = cosmo
BINARY							 = terraform-provider-${NAME}
VERSION 						 = 0.0.1
OS_ARCH  						 = linux_amd64
EXAMPLES   						 = examples

TEST							?= $$(go list ./... | grep -v 'vendor')
HOSTNAME						?= terraform.local

default: testacc

.PHONY: testacc
testacc:
	TF_ACC=1 go test $(TEST) -v -timeout 120m

generate:
	go generate ./...

tidy:
	go mod tidy

fmt:
	go fmt ./...
	terraform fmt -recursive 

build:
	go build -o bin/${BINARY}

install: build
	rm -f ~/.terraform.d/plugins/${HOSTNAME}/${NAMESPACE}/${NAME}/${VERSION}/${OS_ARCH}/${BINARY}
	mkdir -p ~/.terraform.d/plugins/${HOSTNAME}/${NAMESPACE}/${NAME}/${VERSION}/${OS_ARCH}
	mv bin/${BINARY} ~/.terraform.d/plugins/${HOSTNAME}/${NAMESPACE}/${NAME}/${VERSION}/${OS_ARCH}

build-all-arches:
	GOOS=darwin GOARCH=amd64 go build -o ./bin/${BINARY}_${VERSION}_darwin_amd64
	GOOS=freebsd GOARCH=386 go build -o ./bin/${BINARY}_${VERSION}_freebsd_386
	GOOS=freebsd GOARCH=amd64 go build -o ./bin/${BINARY}_${VERSION}_freebsd_amd64
	GOOS=freebsd GOARCH=arm go build -o ./bin/${BINARY}_${VERSION}_freebsd_arm
	GOOS=linux GOARCH=386 go build -o ./bin/${BINARY}_${VERSION}_linux_386
	GOOS=linux GOARCH=amd64 go build -o ./bin/${BINARY}_${VERSION}_linux_amd64
	GOOS=linux GOARCH=arm go build -o ./bin/${BINARY}_${VERSION}_linux_arm
	GOOS=openbsd GOARCH=386 go build -o ./bin/${BINARY}_${VERSION}_openbsd_386
	GOOS=openbsd GOARCH=amd64 go build -o ./bin/${BINARY}_${VERSION}_openbsd_amd64
	GOOS=solaris GOARCH=amd64 go build -o ./bin/${BINARY}_${VERSION}_solaris_amd64
	GOOS=windows GOARCH=386 go build -o ./bin/${BINARY}_${VERSION}_windows_386
	GOOS=windows GOARCH=amd64 go build -o ./bin/${BINARY}_${VERSION}_windows_amd64

release: generate build-all-arches

include examples/Makefile

e2e-cd-apply: 
	make install 
	make e2e-init
	make e2e-apply 

e2e-cd-destroy: 
	make e2e-destroy 

e2e-cosmo-apply: 
	FEATURE=examples/cosmo make install 
	FEATURE=examples/cosmo make e2e-init 
	FEATURE=examples/cosmo make e2e-apply 

e2e-cosmo-destroy: 
	FEATURE=examples/cosmo make e2e-destroy 

e2e-cosmo-monograph-apply: 
	FEATURE=examples/resources/comso_monograph make install 
	FEATURE=examples/resources/comso_monograph make e2e-init 
	FEATURE=examples/resources/comso_monograph make e2e-apply 

e2e-cosmo-monograph-destroy: 
	FEATURE=examples/resources/comso_monograph make e2e-destroy 
