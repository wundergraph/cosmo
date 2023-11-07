FROM golang:1.21 as builder

WORKDIR /app/

# Copy only the files required for go mod download
COPY ./go.* .

# Download dependencies
RUN go mod download

# Copy the rest of the files
COPY . .

# Run tests
RUN go test -v ./...

# Build router
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -a -o router cmd/custom/main.go

FROM gcr.io/distroless/static:latest

COPY --from=builder /app/router /router

ENTRYPOINT ["/router"]

EXPOSE 3002
