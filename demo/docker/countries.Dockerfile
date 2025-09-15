FROM golang:1.25 as builder

WORKDIR /app

COPY . ./

RUN go mod download && go mod verify

RUN go build ./cmd/countries && mv countries server

ENTRYPOINT [ "./server" ]

EXPOSE 4008
