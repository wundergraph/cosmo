-- migrate:up

-- Every span of every sampled trace, sorted for searches across traces: by graph, then 15-minute bucket, then span
-- name and subgraph. A time window prunes to its buckets, and inside each bucket a span-name or subgraph condition
-- prunes granules, without a second, differently sorted copy of the data. One trace by ID is still read from
-- otel_spans_by_trace.
-- The bucket is a stored column, and queries filter on it as well as on Timestamp: ClickHouse does not prune granules
-- through a bucketing function such as toStartOfFifteenMinutes(Timestamp) when more key columns follow it (measured on
-- 24.12: a 15-minute window read 208 of 208 granules that way, 16 of 208 with the stored bucket).
CREATE TABLE IF NOT EXISTS cosmo.span_search (
   FederatedGraphID LowCardinality(String) CODEC(ZSTD(3)),
   OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
   Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(3)),
   TimeBucket DateTime MATERIALIZED toStartOfFifteenMinutes(toDateTime(Timestamp)) CODEC(Delta(4), ZSTD(3)),
   TraceId String CODEC(ZSTD(3)),
   SpanId String CODEC(ZSTD(3)),
   ParentSpanId String CODEC(ZSTD(3)),
   SpanName LowCardinality(String) CODEC(ZSTD(3)),
   SpanKind LowCardinality(String) CODEC(ZSTD(3)),
   ServiceName LowCardinality(String) CODEC(ZSTD(3)),
   Duration Int64 CODEC(ZSTD(3)),
   StatusCode LowCardinality(String) CODEC(ZSTD(3)),
   StatusMessage String CODEC(ZSTD(3)),
   -- The router's root span of a request.
   IsRoot Bool CODEC(ZSTD(3)),
   SubgraphName LowCardinality(String) CODEC(ZSTD(3)),
   SubgraphID LowCardinality(String) CODEC(ZSTD(3)),
   -- From the span's own attributes: the root span, or any span of one operation in a batched request (those also carry
   -- wg.operation.batching.operation_index).
   OperationName String CODEC(ZSTD(3)),
   OperationHash String CODEC(ZSTD(3)),
   OperationType LowCardinality(String) CODEC(ZSTD(3)),
   OperationPersistedID String CODEC(ZSTD(3)),
   ClientName LowCardinality(String) CODEC(ZSTD(3)),
   ClientVersion LowCardinality(String) CODEC(ZSTD(3)),
   HttpStatusCode LowCardinality(String) CODEC(ZSTD(3)),
   FeatureFlag LowCardinality(String) CODEC(ZSTD(3)),
   RouterVersion LowCardinality(String) CODEC(ZSTD(3)),
   ClusterName LowCardinality(String) CODEC(ZSTD(3)),
   ServiceInstanceID String CODEC(ZSTD(3)),
   Hostname LowCardinality(String) CODEC(ZSTD(3)),
   SpanAttributes Map(LowCardinality(String), String) CODEC(ZSTD(3)),

   INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
   INDEX idx_operation_name OperationName TYPE bloom_filter(0.01) GRANULARITY 1,
   INDEX idx_duration Duration TYPE minmax GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (FederatedGraphID, OrganizationID, TimeBucket, SpanName, SubgraphName, Timestamp, TraceId, SpanId)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.span_search;
