# OTEL Collector

This is a custom build of the official [OpenTelemetry Collector](https://github.com/open-telemetry/opentelemetry-collector), a vendor-agnostic service that receives, processes and exports telemetry data.
It receives traces and metrics from the Cosmo Router and writes them to ClickHouse.

## Components

The components are listed in [`otelcol-builder.yaml`](./otelcol-builder.yaml). The default configuration is in [`otel-config.yaml`](./otel-config.yaml).

The `jwtauthextension` lives in [`extension/jwtauthextension`](./extension/jwtauthextension). It validates the router's graph API token (an HMAC-signed JWT) and exposes its claims, so the `attributes` processor can add `wg.organization.id` and `wg.federated_graph.id` to every span and data point.

## Build

Build the image from the root of the repository:

```shell
docker compose -f docker-compose.yml build otelcollector --no-cache
```

The image is built with the [OpenTelemetry Collector Builder](https://opentelemetry.io/docs/collector/custom-collector/) (ocb) and runs on `gcr.io/distroless/static` as a non-root user.

Run the extension tests:

```shell
cd extension/jwtauthextension && go test ./...
```

## Environment variables

| Variable                 | Description                                              | Default     |
| ------------------------ | -------------------------------------------------------- | ----------- |
| `CLICKHOUSE_ENDPOINT`    | ClickHouse DSN.                                          | (required)  |
| `OTEL_INGEST_JWT_SECRET` | Secret used to verify the router's token.                | (required)  |
| `PROMETHEUS_LEVEL`       | Internal telemetry level: `none`, `basic`, `normal`, `detailed`. | `none` |
| `PROMETHEUS_HOST`        | Host for the internal Prometheus metrics endpoint.       | `127.0.0.1` |
| `PROMETHEUS_PORT`        | Port for the internal Prometheus metrics endpoint.       | `8088`      |

## Upgrading the collector

The ClickHouse exporter creates the `otel_*` tables. The materialized views in [`controlplane/clickhouse/migrations`](../controlplane/clickhouse/migrations) read from them. Before you upgrade the collector:

1. Read the `clickhouseexporter` entries in the [contrib changelog](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/CHANGELOG.md) for column, type and value changes.
2. If the exporter inserts into a column that older tables do not have, add a migration that creates it. Existing tables are never changed by the exporter.
3. Keep every component on the same release.

### Upgrading from 0.21.x or older (collector 0.103)

- Run the ClickHouse migrations before or right after you deploy the new collector. Until they run, the new collector cannot write sum and histogram metrics.
- If you mount your own configuration file, update it:
  - Replace `ttl_days: 30` with `ttl: 720h`.
  - Replace `metrics_table_name: otel_metrics` with `metrics_tables` (see `otel-config.yaml`).
  - Replace `service.telemetry.metrics.address` with `service.telemetry.metrics.readers`. The collector now ignores `address`.
  - Replace the `logging` exporter with `debug`.
- `PROMETHEUS_LISTEN_ADDR` is replaced by `PROMETHEUS_HOST` and `PROMETHEUS_PORT`.
- The `prometheusremotewrite` exporter and the `basicauth` extension are no longer included.

## Production checklist

Change the TTL of the otel_metrics_* table to 3 days. In that way, raw metrics will be deleted after 3 days but the materialized view will still be available for 30 days in a compressed format.

Run this for each metrics table:

```sql
ALTER TABLE otel_metrics_histogram MODIFY TTL toDateTime(TimeUnix) + toIntervalDay(7);
OPTIMIZE TABLE otel_metrics_histogram FINAL;
```
