FROM ghcr.io/wundergraph/cosmo/router:0.12.0-onbuild as builder

# Copy custom files
COPY . /app/router/cmd/custom

# The other instructions are inherited from the builder image: download dependencies, run tests, build the binary

FROM gcr.io/distroless/static:latest

COPY --from=builder /app/router /router

ENTRYPOINT ["/router"]

EXPOSE 3002
