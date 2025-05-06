FROM golang:1.23 as builder

WORKDIR /app

COPY . ./

RUN go mod download && go mod verify

RUN go build ./cmd/mood && mv mood server

ENTRYPOINT [ "./server" ]

EXPOSE 4008
