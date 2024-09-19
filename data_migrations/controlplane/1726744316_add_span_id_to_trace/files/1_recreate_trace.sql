-- Drop original table and view
DROP VIEW IF EXISTS cosmo.traces_mv;
DROP TABLE IF EXISTS cosmo.traces;

-- Template table
CREATE TABLE IF NOT EXISTS cosmo.traces_template (
    TraceId String CODEC (ZSTD(3)),
    SpanId String CODEC (ZSTD(3)),
    Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(3)),
    OperationName String CODEC (ZSTD(3)),
    OperationType LowCardinality(String) CODEC (ZSTD(3)),
    FederatedGraphID String CODEC(ZSTD(3)),
    OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
    Duration Int64 CODEC(ZSTD(3)),
    StatusCode LowCardinality(String) CODEC (ZSTD(3)),
    HasError bool CODEC(ZSTD(3)),
    StatusMessage String CODEC (ZSTD(3)),
    OperationHash String CODEC (ZSTD(3)),
    OperationContent String CODEC (ZSTD(3)),
    OperationPersistedID String CODEC (ZSTD(3)),
    HttpStatusCode String CODEC (ZSTD(3)),
    HttpHost String CODEC (ZSTD(3)),
    HttpUserAgent String CODEC (ZSTD(3)),
    HttpMethod String CODEC (ZSTD(3)),
    HttpTarget String CODEC (ZSTD(3)),
    ClientName String CODEC (ZSTD(3)),
    ClientVersion String CODEC (ZSTD(3)),
    Subscription Bool CODEC(ZSTD(3)),
    -- Indexes for filtering because the table serves as a source for the raw traces view
    INDEX idx_operation_name OperationName TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_operation_type OperationType TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_operation_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_operation_persistent_id OperationPersistedID TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_client_name ClientName TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_client_version ClientVersion TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_duration Duration TYPE minmax GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY Timestamp;

-- create temporary traces table
CREATE TABLE IF NOT EXISTS cosmo.temp_traces AS cosmo.traces_template
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (
    FederatedGraphID,
    OrganizationID,
    toUnixTimestamp(Timestamp),
    OperationType,
    ClientName,
    HttpStatusCode,
    ClientVersion,
    Duration,
    OperationName,
    OperationPersistedID,
    OperationHash
)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- create temporary mv for the above table
CREATE MATERIALIZED VIEW IF NOT EXISTS cosmo.temp_traces_mv TO cosmo.temp_traces AS
SELECT TraceId,
    SpanId,
    toDateTime(Timestamp, 'UTC') as Timestamp,
    SpanAttributes [ 'wg.operation.name' ] as OperationName,
    toLowCardinality(SpanAttributes [ 'wg.operation.type' ]) as OperationType,
    SpanAttributes [ 'wg.federated_graph.id'] as FederatedGraphID,
    toLowCardinality(SpanAttributes ['wg.organization.id']) as OrganizationID,
    Duration,
    toLowCardinality(StatusCode) as StatusCode,
    if(
        StatusMessage == 'STATUS_CODE_ERROR'
        OR position(SpanAttributes ['http.status_code'], '5') = 1
        OR position(SpanAttributes ['http.status_code'], '4') = 1
        OR mapContains(SpanAttributes, 'wg.request.error'),
        true,
        false
    ) as HasError,
    StatusMessage,
    SpanAttributes [ 'wg.operation.hash' ] as OperationHash,
    SpanAttributes [ 'wg.operation.content' ] as OperationContent,
    SpanAttributes [ 'wg.operation.persisted_id' ] as OperationPersistedID,
    SpanAttributes [ 'http.status_code' ] as HttpStatusCode,
    SpanAttributes [ 'http.host' ] as HttpHost,
    SpanAttributes [ 'http.user_agent' ] as HttpUserAgent,
    SpanAttributes [ 'http.method' ] as HttpMethod,
    SpanAttributes [ 'http.target' ] as HttpTarget,
    SpanAttributes [ 'wg.client.name' ] as ClientName,
    SpanAttributes [ 'wg.client.version' ] as ClientVersion,
    mapContains(SpanAttributes, 'wg.subscription') as Subscription
FROM cosmo.otel_traces
WHERE -- Only include router root spans
    SpanAttributes [ 'wg.router.root_span' ] = 'true'
    OR -- For backwards compatibility (router < 0.61.2)
    SpanAttributes [ 'wg.component.name' ] = 'router-server'
ORDER BY Timestamp DESC;

-- Recreate original table
CREATE TABLE IF NOT EXISTS cosmo.traces AS cosmo.traces_template
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (
    FederatedGraphID,
    OrganizationID,
    toUnixTimestamp(Timestamp),
    OperationType,
    ClientName,
    HttpStatusCode,
    ClientVersion,
    Duration,
    OperationName,
    OperationPersistedID,
    OperationHash
)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- DROP template table
DROP TABLE IF EXISTS cosmo.traces_template;