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

install:
	rm -f ~/.terraform.d/plugins/${HOSTNAME}/${NAMESPACE}/${NAME}/${VERSION}/${OS_ARCH}/${BINARY}
	mkdir -p ~/.terraform.d/plugins/${HOSTNAME}/${NAMESPACE}/${NAME}/${VERSION}/${OS_ARCH}
	mv bin/${BINARY} ~/.terraform.d/plugins/${HOSTNAME}/${NAMESPACE}/${NAME}/${VERSION}/${OS_ARCH}

clean-local:
	rm -rf bin
	rm -rf ~/.terraform.d/plugins/${HOSTNAME}/${NAMESPACE}/${NAME}/${VERSION}/${OS_ARCH}

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

.PHONY: e2e-apply-cd e2e-destroy-cd e2e-clean-cd
.PHONY: e2e-apply-cosmo e2e-destroy-cosmo e2e-clean-cosmo
.PHONY: e2e-apply-cosmo-monograph e2e-destroy-cosmo-monograph e2e-clean-cosmo-monograph
.PHONY: e2e-cd e2e-cosmo e2e-cosmo-monograph clean

e2e-apply-cd:
	FEATURE=examples/provider make e2e-init
	FEATURE=examples/provider make e2e-apply 

e2e-destroy-cd: 
	make e2e-destroy 

e2e-clean-cd: 
	make e2e-clean 

e2e-apply-cosmo: 
	FEATURE=examples/cosmo make e2e-init 
	FEATURE=examples/cosmo make e2e-apply 

e2e-destroy-cosmo: 
	FEATURE=examples/cosmo make e2e-destroy 

e2e-clean-cosmo: 
	FEATURE=examples/cosmo make e2e-clean

e2e-apply-cosmo-monograph: 
	FEATURE=examples/resources/comso_monograph make e2e-init 
	FEATURE=examples/resources/comso_monograph make e2e-apply 

e2e-destroy-cosmo-monograph: 
	FEATURE=examples/resources/comso_monograph make e2e-destroy 

e2e-clean-cosmo-monograph: 
	FEATURE=examples/resources/comso_monograph make e2e-clean

## Convenience targets to run specific e2e tests

e2e-cd: e2e-apply-cd e2e-destroy-cd
e2e-cosmo: e2e-apply-cosmo e2e-destroy-cosmo
e2e-cosmo-monograph: e2e-apply-cosmo-monograph e2e-destroy-cosmo-monograph

e2e: e2e-cd e2e-cosmo e2e-cosmo-monograph

clean: e2e-clean-cd e2e-clean-cosmo e2e-clean-cosmo-monograph clean-local
destroy: e2e-destroy-cd e2e-destroy-cosmo e2e-destroy-cosmo-monograph