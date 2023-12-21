FROM golang:1.21 as builder

ARG VERSION=dev

ENV VERSION=$VERSION

WORKDIR /app/

# Copy only the files required for go mod download
COPY go.* .

# Download dependencies
RUN go mod download

# Copy the rest of the files
COPY . .

# Run tests
RUN make test

# Build router
RUN make build VERSION=${VERSION}

FROM gcr.io/distroless/base-debian12

COPY --from=builder /app/router /router

CMD ["/router"]

EXPOSE 3002
