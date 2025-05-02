FROM --platform=${BUILDPLATFORM} golang:1.23 AS builder

ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}

WORKDIR /app/

# Copy only the files required for go mod download
COPY ./go.* .

# Download dependencies
RUN go mod download

# Copy the rest of the files
COPY . .

# Build router
RUN CGO_ENABLED=0 go build -a -o ./dist/service cmd/${SERVICE_NAME}/main.go

FROM --platform=${BUILDPLATFORM} gcr.io/distroless/base-debian12

COPY --from=builder /app/dist/service /service

CMD ["/service"]

EXPOSE 4004