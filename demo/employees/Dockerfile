FROM golang:1.20

WORKDIR /app

COPY go.mod go.sum ./

RUN mkdir ../otel
COPY otel ../otel/

RUN go mod download && go mod verify

COPY . .

RUN go build -o server

ENTRYPOINT [ "./server" ]

EXPOSE 4001
