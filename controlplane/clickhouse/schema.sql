
--
-- Database schema
--

CREATE DATABASE IF NOT EXISTS cosmo;

CREATE TABLE cosmo.`.inner_id.3c8d0e93-937f-4072-ac49-2f680228037d`
(
    `Timestamp` DateTime('UTC') CODEC(Delta(4), ZSTD(1)),
    `HttpStatusCode` String CODEC(ZSTD(1)),
    `OrganizationID` String CODEC(ZSTD(1)),
    `FederatedGraphID` String CODEC(ZSTD(1)),
    `TotalRequests` UInt64 CODEC(ZSTD(1)),
    `DurationQuantiles` AggregateFunction(quantiles(0.5, 0.75, 0.9, 0.95, 0.99), Int64) CODEC(ZSTD(1)),
    `LastCalled` DateTime('UTC') CODEC(ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, HttpStatusCode)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE cosmo.`.inner_id.70f42704-1b82-43eb-8f5d-e2225e3aa032`
(
    `TraceId` String CODEC(ZSTD(1)),
    `Timestamp` DateTime('UTC') CODEC(Delta(4), ZSTD(1)),
    `OperationName` String CODEC(ZSTD(1)),
    `OperationType` String CODEC(ZSTD(1)),
    `FederatedGraphID` String CODEC(ZSTD(1)),
    `OrganizationID` String CODEC(ZSTD(1)),
    `Duration` Int64 CODEC(ZSTD(1)),
    `StatusCode` LowCardinality(String) CODEC(ZSTD(1)),
    `StatusMessage` String CODEC(ZSTD(1)),
    `OperationHash` String CODEC(ZSTD(1)),
    `OperationContent` String CODEC(ZSTD(1)),
    `HttpStatusCode` String CODEC(ZSTD(1)),
    `HttpHost` String CODEC(ZSTD(1)),
    `HttpUserAgent` String CODEC(ZSTD(1)),
    `HttpMethod` String CODEC(ZSTD(1)),
    `HttpTarget` String CODEC(ZSTD(1)),
    `ClientName` String CODEC(ZSTD(1)),
    `Subscription` Bool CODEC(ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (toUnixTimestamp(Timestamp), FederatedGraphID, OrganizationID, OperationName, OperationType)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE cosmo.`.inner_id.89a02a17-90d8-4a9e-a7b5-03540c3016eb`
(
    `Timestamp` DateTime('UTC') CODEC(Delta(4), ZSTD(1)),
    `OperationName` String CODEC(ZSTD(1)),
    `OperationType` String CODEC(ZSTD(1)),
    `FederatedGraphID` String CODEC(ZSTD(1)),
    `OrganizationID` String CODEC(ZSTD(1)),
    `IsSubscription` Bool CODEC(ZSTD(1)),
    `TotalRequests` UInt64 CODEC(ZSTD(1)),
    `TotalRequestsError` UInt64 CODEC(ZSTD(1)),
    `TotalRequestsOk` UInt64 CODEC(ZSTD(1)),
    `DurationQuantiles` AggregateFunction(quantiles(0.5, 0.75, 0.9, 0.95, 0.99), Int64) CODEC(ZSTD(1)),
    `LastCalled` DateTime('UTC') CODEC(ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, OperationName, OperationType)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE cosmo.`.inner_id.d715af6b-677f-4397-aa5a-012e8a75060d`
(
    `Timestamp` DateTime('UTC') CODEC(Delta(4), ZSTD(1)),
    `ClientName` String CODEC(ZSTD(1)),
    `ClientVersion` String CODEC(ZSTD(1)),
    `OrganizationID` String CODEC(ZSTD(1)),
    `FederatedGraphID` String CODEC(ZSTD(1)),
    `TotalRequests` UInt64 CODEC(ZSTD(1)),
    `TotalRequestsError` UInt64 CODEC(ZSTD(1)),
    `TotalRequestsOk` UInt64 CODEC(ZSTD(1)),
    `DurationQuantiles` AggregateFunction(quantiles(0.5, 0.75, 0.9, 0.95, 0.99), Int64) CODEC(ZSTD(1)),
    `LastCalled` DateTime('UTC') CODEC(ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, ClientName)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE cosmo.otel_traces
(
    `Timestamp` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    `TraceId` String CODEC(ZSTD(1)),
    `SpanId` String CODEC(ZSTD(1)),
    `ParentSpanId` String CODEC(ZSTD(1)),
    `TraceState` String CODEC(ZSTD(1)),
    `SpanName` LowCardinality(String) CODEC(ZSTD(1)),
    `SpanKind` LowCardinality(String) CODEC(ZSTD(1)),
    `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
    `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    `ScopeName` String CODEC(ZSTD(1)),
    `ScopeVersion` String CODEC(ZSTD(1)),
    `SpanAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    `Duration` Int64 CODEC(ZSTD(1)),
    `StatusCode` LowCardinality(String) CODEC(ZSTD(1)),
    `StatusMessage` String CODEC(ZSTD(1)),
    `Events.Timestamp` Array(DateTime64(9)) CODEC(ZSTD(1)),
    `Events.Name` Array(LowCardinality(String)) CODEC(ZSTD(1)),
    `Events.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    `Links.TraceId` Array(String) CODEC(ZSTD(1)),
    `Links.SpanId` Array(String) CODEC(ZSTD(1)),
    `Links.TraceState` Array(String) CODEC(ZSTD(1)),
    `Links.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_attr_value mapValues(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_duration Duration TYPE minmax GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SpanName, toUnixTimestamp(Timestamp), TraceId)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE cosmo.otel_traces_trace_id_ts
(
    `TraceId` String CODEC(ZSTD(1)),
    `Start` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    `End` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = MergeTree
ORDER BY (TraceId, toUnixTimestamp(Start))
TTL toDateTime(Start) + toIntervalDay(30)
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW cosmo.otel_traces_trace_id_ts_mv TO cosmo.otel_traces_trace_id_ts
(
    `TraceId` String,
    `Start` DateTime64(9),
    `End` DateTime64(9)
) AS
SELECT
    TraceId,
    min(Timestamp) AS Start,
    max(Timestamp) AS End
FROM cosmo.otel_traces
WHERE TraceId != ''
GROUP BY TraceId;

CREATE TABLE cosmo.schema_migrations
(
    `version` String,
    `ts` DateTime DEFAULT now(),
    `applied` UInt8 DEFAULT 1
)
ENGINE = ReplacingMergeTree(ts)
PRIMARY KEY version
ORDER BY version
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW cosmo.traces_by_client_quarter_hourly_mv
(
    `Timestamp` DateTime('UTC') CODEC(Delta(4), ZSTD(1)),
    `ClientName` String CODEC(ZSTD(1)),
    `ClientVersion` String CODEC(ZSTD(1)),
    `OrganizationID` String CODEC(ZSTD(1)),
    `FederatedGraphID` String CODEC(ZSTD(1)),
    `TotalRequests` UInt64 CODEC(ZSTD(1)),
    `TotalRequestsError` UInt64 CODEC(ZSTD(1)),
    `TotalRequestsOk` UInt64 CODEC(ZSTD(1)),
    `DurationQuantiles` AggregateFunction(quantiles(0.5, 0.75, 0.9, 0.95, 0.99), Int64) CODEC(ZSTD(1)),
    `LastCalled` DateTime('UTC') CODEC(ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, ClientName)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1 AS
SELECT
    toDateTime(toStartOfInterval(Timestamp, toIntervalMinute(15)), 'UTC') AS Timestamp,
    SpanAttributes['wg.client.name'] AS ClientName,
    SpanAttributes['wg.client.version'] AS ClientVersion,
    SpanAttributes['wg.organization.id'] AS OrganizationID,
    SpanAttributes['wg.federated_graph.id'] AS FederatedGraphID,
    count() AS TotalRequests,
    countIf((StatusCode = 'STATUS_CODE_ERROR') OR (position(SpanAttributes['http.status_code'], '5') = 1)) AS TotalRequestsError,
    countIf((StatusCode != 'STATUS_CODE_ERROR') OR (position(SpanAttributes['http.status_code'], '5') != 1)) AS TotalRequestsOk,
    quantilesState(0.5, 0.75, 0.9, 0.95, 0.99)(Duration) AS DurationQuantiles,
    toUnixTimestamp(max(Timestamp)) AS LastCalled
FROM cosmo.otel_traces
WHERE empty(ParentSpanId)
GROUP BY
    Timestamp,
    ClientName,
    ClientVersion,
    FederatedGraphID,
    OrganizationID
ORDER BY Timestamp DESC;

CREATE MATERIALIZED VIEW cosmo.traces_by_http_status_code_quarter_hourly_mv
(
    `Timestamp` DateTime('UTC') CODEC(Delta(4), ZSTD(1)),
    `HttpStatusCode` String CODEC(ZSTD(1)),
    `OrganizationID` String CODEC(ZSTD(1)),
    `FederatedGraphID` String CODEC(ZSTD(1)),
    `TotalRequests` UInt64 CODEC(ZSTD(1)),
    `DurationQuantiles` AggregateFunction(quantiles(0.5, 0.75, 0.9, 0.95, 0.99), Int64) CODEC(ZSTD(1)),
    `LastCalled` DateTime('UTC') CODEC(ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, HttpStatusCode)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1 AS
SELECT
    toDateTime(toStartOfInterval(Timestamp, toIntervalMinute(15)), 'UTC') AS Timestamp,
    SpanAttributes['http.status_code'] AS HttpStatusCode,
    SpanAttributes['wg.organization.id'] AS OrganizationID,
    SpanAttributes['wg.federated_graph.id'] AS FederatedGraphID,
    count() AS TotalRequests,
    quantilesState(0.5, 0.75, 0.9, 0.95, 0.99)(Duration) AS DurationQuantiles,
    toUnixTimestamp(max(Timestamp)) AS LastCalled
FROM cosmo.otel_traces
WHERE empty(ParentSpanId)
GROUP BY
    Timestamp,
    HttpStatusCode,
    FederatedGraphID,
    OrganizationID
ORDER BY Timestamp DESC;

CREATE MATERIALIZED VIEW cosmo.traces_by_operation_quarter_hourly_mv
(
    `Timestamp` DateTime('UTC') CODEC(Delta(4), ZSTD(1)),
    `OperationName` String CODEC(ZSTD(1)),
    `OperationType` String CODEC(ZSTD(1)),
    `FederatedGraphID` String CODEC(ZSTD(1)),
    `OrganizationID` String CODEC(ZSTD(1)),
    `IsSubscription` Bool CODEC(ZSTD(1)),
    `TotalRequests` UInt64 CODEC(ZSTD(1)),
    `TotalRequestsError` UInt64 CODEC(ZSTD(1)),
    `TotalRequestsOk` UInt64 CODEC(ZSTD(1)),
    `DurationQuantiles` AggregateFunction(quantiles(0.5, 0.75, 0.9, 0.95, 0.99), Int64) CODEC(ZSTD(1)),
    `LastCalled` DateTime('UTC') CODEC(ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (toUnixTimestamp(Timestamp), OrganizationID, FederatedGraphID, OperationName, OperationType)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1 AS
SELECT
    toDateTime(toStartOfInterval(Timestamp, toIntervalMinute(15)), 'UTC') AS Timestamp,
    SpanAttributes['wg.operation.name'] AS OperationName,
    SpanAttributes['wg.operation.type'] AS OperationType,
    SpanAttributes['wg.federated_graph.id'] AS FederatedGraphID,
    SpanAttributes['wg.organization.id'] AS OrganizationID,
    mapContains(SpanAttributes, 'wg.subscription') AS IsSubscription,
    count() AS TotalRequests,
    countIf((StatusCode = 'STATUS_CODE_ERROR') OR (position(SpanAttributes['http.status_code'], '5') = 1)) AS TotalRequestsError,
    countIf((StatusCode != 'STATUS_CODE_ERROR') OR (position(SpanAttributes['http.status_code'], '5') != 1)) AS TotalRequestsOk,
    quantilesState(0.5, 0.75, 0.9, 0.95, 0.99)(Duration) AS DurationQuantiles,
    toUnixTimestamp(max(Timestamp)) AS LastCalled
FROM cosmo.otel_traces
WHERE empty(ParentSpanId)
GROUP BY
    Timestamp,
    FederatedGraphID,
    OrganizationID,
    OperationName,
    OperationType,
    IsSubscription
ORDER BY Timestamp DESC;

CREATE MATERIALIZED VIEW cosmo.traces_mv
(
    `TraceId` String CODEC(ZSTD(1)),
    `Timestamp` DateTime('UTC') CODEC(Delta(4), ZSTD(1)),
    `OperationName` String CODEC(ZSTD(1)),
    `OperationType` String CODEC(ZSTD(1)),
    `FederatedGraphID` String CODEC(ZSTD(1)),
    `OrganizationID` String CODEC(ZSTD(1)),
    `Duration` Int64 CODEC(ZSTD(1)),
    `StatusCode` LowCardinality(String) CODEC(ZSTD(1)),
    `StatusMessage` String CODEC(ZSTD(1)),
    `OperationHash` String CODEC(ZSTD(1)),
    `OperationContent` String CODEC(ZSTD(1)),
    `HttpStatusCode` String CODEC(ZSTD(1)),
    `HttpHost` String CODEC(ZSTD(1)),
    `HttpUserAgent` String CODEC(ZSTD(1)),
    `HttpMethod` String CODEC(ZSTD(1)),
    `HttpTarget` String CODEC(ZSTD(1)),
    `ClientName` String CODEC(ZSTD(1)),
    `Subscription` Bool CODEC(ZSTD(1))
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (toUnixTimestamp(Timestamp), FederatedGraphID, OrganizationID, OperationName, OperationType)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1 AS
SELECT
    TraceId,
    Timestamp,
    SpanAttributes['wg.operation.name'] AS OperationName,
    SpanAttributes['wg.operation.type'] AS OperationType,
    SpanAttributes['wg.federated_graph.id'] AS FederatedGraphID,
    SpanAttributes['wg.organization.id'] AS OrganizationID,
    Duration,
    StatusCode,
    StatusMessage,
    SpanAttributes['wg.operation.hash'] AS OperationHash,
    SpanAttributes['wg.operation.content'] AS OperationContent,
    SpanAttributes['http.status_code'] AS HttpStatusCode,
    SpanAttributes['http.host'] AS HttpHost,
    SpanAttributes['http.user_agent'] AS HttpUserAgent,
    SpanAttributes['http.method'] AS HttpMethod,
    SpanAttributes['http.target'] AS HttpTarget,
    SpanAttributes['wg.client.name'] AS ClientName,
    mapContains(SpanAttributes, 'wg.subscription') AS Subscription
FROM cosmo.otel_traces
WHERE empty(ParentSpanId)
ORDER BY Timestamp DESC;


--
-- Dbmate schema migrations
--

INSERT INTO schema_migrations (version) VALUES
    ('20230825095359'),
    ('20230910193138'),
    ('20230910200148'),
    ('20230910201357');
