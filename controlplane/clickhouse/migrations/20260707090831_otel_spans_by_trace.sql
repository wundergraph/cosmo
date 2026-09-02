-- migrate:up

CREATE TABLE IF NOT EXISTS cosmo.otel_spans_by_trace (
   FederatedGraphID String CODEC (ZSTD(3)),
   OrganizationID LowCardinality(String) CODEC (ZSTD(3)),
   TraceId String CODEC (ZSTD(3)),
   Timestamp DateTime64(9) CODEC (Delta(8), ZSTD(3)),
   SpanId String CODEC (ZSTD(3)),
   ParentSpanId String CODEC (ZSTD(3)),
   SpanName LowCardinality(String) CODEC (ZSTD(3)),
   SpanKind LowCardinality(String) CODEC (ZSTD(3)),
   ServiceName LowCardinality(String) CODEC (ZSTD(3)),
   Duration Int64 CODEC (ZSTD(3)),
   StatusCode LowCardinality(String) CODEC (ZSTD(3)),
   StatusMessage String CODEC (ZSTD(3)),
   ScopeName String CODEC (ZSTD(3)),
   SpanAttributes Map(LowCardinality(String), String) CODEC (ZSTD(3))
) ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (FederatedGraphID, OrganizationID, TraceId, Timestamp, SpanId)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.otel_spans_by_trace
