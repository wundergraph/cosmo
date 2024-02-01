FROM golang:1.21 as builder

WORKDIR /app

# Download binary from github
RUN curl -LJO https://github.com/open-telemetry/opentelemetry-collector/releases/download/cmd%2Fbuilder%2Fv0.93.0/ocb_0.93.0_linux_amd64 \
    && chmod +x ocb_0.93.0_linux_amd64 \
    && mv ocb_0.93.0_linux_amd64 ocb

COPY ./otelcol-builder.yaml ./otelcol-builder.yaml

RUN ./ocb --config otelcol-builder.yaml \
    && chmod +x /app/otelcol-dev/otelcol \
    && /app/otelcol-dev/otelcol --version

FROM golang:1.21

COPY ./otel-config.yaml /etc/otel-config.yaml
COPY --from=builder /app/otelcol-dev/otelcol /otelcol

# directory we use for clickhouse data for the file_storage extension
RUN mkdir -p "/var/lib/otelcol/file_storage/clickhouse" \
    && chmod -R 755 "/var/lib/otelcol/file_storage/clickhouse" \

# smoke test
RUN /otelcol --version


ENTRYPOINT ["/otelcol"]
CMD ["--config", "/etc/otel-config.yaml"]
