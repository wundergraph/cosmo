FROM golang:1.20 as builder

WORKDIR /app/

# Copy only the files required for go mod download
COPY ./router/go.* ./router/

WORKDIR /app/router

# Download dependencies
RUN go mod download

WORKDIR /app/

# Copy the rest of the files
COPY . /app/

# Install tools
RUN make setup-tools

# Generate code
RUN buf generate --template buf.go.gen.yaml

WORKDIR /app/router

# Run tests
RUN make test

# Build router
RUN make build

FROM gcr.io/distroless/static:latest

COPY --from=builder /app/router/router /router

ENTRYPOINT ["/router"]

EXPOSE 3002
