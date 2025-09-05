FROM golang:1.25 as builder

WORKDIR /app

COPY . ./

RUN go mod download && go mod verify

RUN go build ./cmd/test1 && mv test1 server

ENTRYPOINT [ "./server" ]

EXPOSE 4002
