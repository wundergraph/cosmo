dev:
	go run main.go

test:
	go test ./...

build:
	CGO_ENABLED=0 GOOS=linux go build -trimpath -a -o router cmd/router/main.go