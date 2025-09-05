FROM golang:1.25 as builder

WORKDIR /app

COPY . ./

RUN go mod download && go mod verify

RUN go build ./cmd/products_fg && mv products_fg server

ENTRYPOINT [ "./server" ]

EXPOSE 4010
