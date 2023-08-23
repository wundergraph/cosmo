FROM golang:1.20 as builder

WORKDIR /app

COPY go.mod go.sum ./

RUN go mod download && go mod verify

COPY . .

RUN go build -o server

ENTRYPOINT [ "./server" ]

EXPOSE 4002