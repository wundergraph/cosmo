FROM --platform=${BUILDPLATFORM} golang:1.26 AS builder

ARG BUILDARCH
ARG TARGETOS
ARG TARGETARCH
ARG OCB_VERSION=0.165.0

WORKDIR /app

# ocb runs on the build platform, so download the binary for BUILDARCH and verify its checksum.
RUN OCB_URL="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/cmd%2Fbuilder%2Fv${OCB_VERSION}/ocb_${OCB_VERSION}_linux_${BUILDARCH}" \
    && curl -fsSL -o ocb "${OCB_URL}" \
    && echo "$(curl -fsSL "${OCB_URL}.sha256" | cut -d ' ' -f 1)  ocb" | sha256sum -c - \
    && chmod +x ocb

COPY ./otelcol-builder.yaml ./otelcol-builder.yaml
COPY ./extension ./extension

# CGO_ENABLED=0 produces a static binary that runs on distroless/static.
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} ./ocb --config otelcol-builder.yaml

FROM gcr.io/distroless/static-debian13:nonroot

COPY ./otel-config.yaml /etc/otel-config.yaml
COPY --from=builder /app/otelcol-dev/otelcol /otelcol

# smoke test (exec form, the image has no shell)
RUN ["/otelcol", "--version"]

USER 65532

EXPOSE 4317 4318 13133

ENTRYPOINT ["/otelcol"]
CMD ["--config", "/etc/otel-config.yaml"]
