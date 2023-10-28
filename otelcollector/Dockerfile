FROM golang:1.20 as builder

WORKDIR /app

COPY ./scripts/intall_ocb.sh ./install_ocb.sh
RUN ./install_ocb.sh

COPY ./otelcol-builder.yaml ./otelcol-builder.yaml

RUN ./ocb --config otelcol-builder.yaml \
    && chmod +x /app/otelcol-dev/otelcol \
    && /app/otelcol-dev/otelcol --version

FROM golang:1.20

COPY ./otel-config.yaml /etc/otel-config.yaml
COPY --from=builder /app/otelcol-dev/otelcol /otelcol
RUN /otelcol --version


ENTRYPOINT ["/otelcol"]
CMD ["--config", "/etc/otel-config.yaml"]
