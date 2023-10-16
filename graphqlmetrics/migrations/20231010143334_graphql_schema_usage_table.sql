-- migrate:up

create table graphql_schema_field_usage_reports
(
    Timestamp DateTime64(9) CODEC(Delta, ZSTD(1)),

    -- Organization
    OrganizationID LowCardinality(String) CODEC(ZSTD(1)),

    -- Router configuration
    FederatedGraphID LowCardinality(String) CODEC(ZSTD(1)),
    RouterConfigVersion LowCardinality(String) CODEC(ZSTD(1)), -- running schema version

    -- Operation
    OperationHash String CODEC(ZSTD(1)),
    OperationType LowCardinality(String) CODEC(ZSTD(1)), -- query, mutation, subscription

    -- Define how often a field is used. Useful for batching at the collection layer.
    Count UInt64 CODEC(Delta, ZSTD(1)),

    -- Schema usage
    Path Array(String) CODEC(ZSTD(1)),
    TypeNames Array(String) CODEC(ZSTD(1)),

    -- Client information
    ClientName LowCardinality(String) CODEC(ZSTD(1)),
    ClientVersion LowCardinality(String) CODEC(ZSTD(1)),

    -- SubgraphIDs identify the subgraphs that were used to resolve the field
    SubgraphIDs Array(LowCardinality(String)) CODEC(ZSTD(1)),

    -- Additional information
    Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),

    INDEX idx_operation_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_path Path TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_source_ids SubgraphIDs TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_type_names TypeNames TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_count Count TYPE minmax GRANULARITY 1
)
    engine = MergeTree PARTITION BY toDate(Timestamp)
        ORDER BY (OrganizationID, FederatedGraphID, ClientName, ClientVersion, RouterConfigVersion, OperationHash, toUnixTimestamp(Timestamp))
        -- We keep 3 days of data as rolling window
        TTL toDateTime(Timestamp) + toIntervalDay(3)
        SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE graphql_schema_field_usage_reports;
