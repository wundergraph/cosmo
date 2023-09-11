-- migrate:up

CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.traces_mv (
   TraceId String CODEC (ZSTD(1)),
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(1)),
   OperationName String CODEC (ZSTD(1)),
   OperationType String CODEC (ZSTD(1)),
   FederatedGraphID String CODEC(ZSTD(1)),
   OrganizationID String CODEC(ZSTD(1)),
   Duration Int64 CODEC(ZSTD(1)),
   StatusCode LowCardinality(String) CODEC (ZSTD(1)),
   StatusMessage String CODEC (ZSTD(1)),
   OperationHash String CODEC (ZSTD(1)),
   OperationContent String CODEC (ZSTD(1)),
   HttpStatusCode String CODEC (ZSTD(1)),
   HttpHost String CODEC (ZSTD(1)),
   HttpUserAgent String CODEC (ZSTD(1)),
   HttpMethod String CODEC (ZSTD(1)),
   HttpTarget String CODEC (ZSTD(1)),
   ClientName String CODEC (ZSTD(1)),
   Subscription Bool CODEC(ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (
    toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, OperationName, OperationType
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1 POPULATE AS
SELECT
    TraceId,
    Timestamp,
    SpanAttributes [ 'wg.operation.name' ] as OperationName,
    SpanAttributes [ 'wg.operation.type' ] as OperationType,
    SpanAttributes [ 'wg.federated_graph.id'] as FederatedGraphID,
    SpanAttributes ['wg.organization.id'] as OrganizationID,
    Duration,
    StatusCode,
    StatusMessage,
    SpanAttributes [ 'wg.operation.hash' ] as OperationHash,
    SpanAttributes [ 'wg.operation.content' ] as OperationContent,
    SpanAttributes [ 'http.status_code' ] as HttpStatusCode,
    SpanAttributes [ 'http.host' ] as HttpHost,
    SpanAttributes [ 'http.user_agent' ] as HttpUserAgent,
    SpanAttributes [ 'http.method' ] as HttpMethod,
    SpanAttributes [ 'http.target' ] as HttpTarget,
    SpanAttributes [ 'wg.client.name' ] as ClientName,
    mapContains(SpanAttributes, 'wg.subscription') as Subscription
FROM
    cosmo.otel_traces
WHERE
    empty(ParentSpanId)
ORDER BY
    Timestamp DESC;

-- migrate:down

DROP VIEW IF EXISTS cosmo.traces_mv