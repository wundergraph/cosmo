FROM golang:1.25-alpine AS build
WORKDIR /src
COPY main.go .
RUN go mod init lat-proxy && CGO_ENABLED=0 go build -ldflags '-s -w' -o /lat-proxy .

FROM alpine:3.20
COPY --from=build /lat-proxy /lat-proxy
ENTRYPOINT ["/lat-proxy"]
