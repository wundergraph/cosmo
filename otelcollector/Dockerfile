FROM --platform=${BUILDPLATFORM} golang:1.21 as builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /app

# Download binary from github
RUN curl -LJO https://github.com/open-telemetry/opentelemetry-collector/releases/download/cmd%2Fbuilder%2Fv0.101.0/ocb_0.101.0_linux_${TARGETARCH} \
    && chmod +x ocb_0.101.0_linux_${TARGETARCH} \
    && mv ocb_0.101.0_linux_${TARGETARCH} ocb

COPY ./otelcol-builder.yaml ./otelcol-builder.yaml

RUN ./ocb --config otelcol-builder.yaml --skip-strict-versioning \
    && chmod +x /app/otelcol-dev/otelcol \
    && /app/otelcol-dev/otelcol --version

FROM --platform=${BUILDPLATFORM} golang:1.21

COPY ./otel-config.yaml /etc/otel-config.yaml
COPY --from=builder /app/otelcol-dev/otelcol /otelcol

# smoke test
RUN /otelcol --version


ENTRYPOINT ["/otelcol"]
CMD ["--config", "/etc/otel-config.yaml"]
