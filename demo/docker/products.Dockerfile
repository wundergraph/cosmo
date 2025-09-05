FROM golang:1.25 as builder

WORKDIR /app

COPY . ./

RUN go mod download && go mod verify

RUN go build ./cmd/products && mv products server

ENTRYPOINT [ "./server" ]

EXPOSE 4004
