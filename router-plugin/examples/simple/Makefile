PHONY: generate-proto
generate-proto:
	@rm -rf userv1
	@mkdir -p userv1
	protoc --go_out=userv1 --go_opt=paths=source_relative \
		--go-grpc_out=userv1 --go-grpc_opt=paths=source_relative \
		user/v1/user.proto

PHONY: compile-plugin
compile-plugin:
	go build -o server-plugin cmd/server/main.go

PHONY: run-client
run-client:
	go run cmd/client/*.go
