-- migrate:up

CREATE TABLE IF NOT EXISTS gql_metrics_schema_usage
(
    -- See https://github.com/PostHog/posthog/issues/10616 why ZSTD(3) is used
    Timestamp DateTime('UTC') CODEC(Delta, ZSTD(3)),

    -- Organization
    OrganizationID LowCardinality(String) CODEC(ZSTD(3)),

    -- Router configuration
    FederatedGraphID LowCardinality(String) CODEC(ZSTD(3)),
    RouterConfigVersion LowCardinality(String) CODEC(ZSTD(3)), -- running schema version

    -- Operation
    OperationHash LowCardinality(String) CODEC(ZSTD(3)),
    OperationName LowCardinality(String) CODEC(ZSTD(3)),
    OperationType LowCardinality(String) CODEC(ZSTD(3)), -- query, mutation, subscription

    -- Define how often a field is used. Useful for batching at the collection layer.
    Count UInt64 CODEC(Delta, ZSTD(3)),

    -- Schema usage
    Path Array(String) CODEC(ZSTD(3)),
    TypeNames Array(String) CODEC(ZSTD(3)), -- Sorted before insertion
    NamedType String CODEC(ZSTD(3)),

    -- Client information
    ClientName LowCardinality(String) CODEC(ZSTD(3)),
    ClientVersion LowCardinality(String) CODEC(ZSTD(3)),

    --- Request information
    HttpStatusCode String CODEC (ZSTD(3)),
    HasError bool CODEC(ZSTD(3)), -- Whether the operation has an error of any kind

    -- SubgraphIDs identify the subgraphs that were used to resolve the field
    SubgraphIDs Array(LowCardinality(String)) CODEC(ZSTD(3)), -- Sorted before insertion

    -- Additional information
    Attributes Map(LowCardinality(String), String) CODEC(ZSTD(3)),

    INDEX idx_operation_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_path Path TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_source_ids SubgraphIDs TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_type_names TypeNames TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_count Count TYPE minmax GRANULARITY 1
)
    engine = MergeTree PARTITION BY toDate(Timestamp)
        ORDER BY (OrganizationID, FederatedGraphID, ClientName, ClientVersion, RouterConfigVersion, OperationHash, HttpStatusCode, HasError, toUnixTimestamp(Timestamp))
        -- We keep 7 days of data as rolling window
        TTL toDateTime(Timestamp) + toIntervalDay(7)
        SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS gql_metrics_schema_usage;
