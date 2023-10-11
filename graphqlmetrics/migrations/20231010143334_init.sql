-- migrate:up

create table cosmo.graphql_field_metrics
(
    Timestamp DateTime64(9) CODEC(Delta, ZSTD(1)),
    ID String CODEC(ZSTD(1)),
    OrganizationID LowCardinality(String) CODEC(ZSTD(1)),
    FederatedGraphID LowCardinality(String) CODEC(ZSTD(1)),
    RouterVersion LowCardinality(String) CODEC(ZSTD(1)),
    OperationName LowCardinality(String) CODEC(ZSTD(1)),
    Duration Int64 CODEC(ZSTD(1)),
    ClientName LowCardinality(String) CODEC(ZSTD(1)),
    ClientVersion LowCardinality(String) CODEC(ZSTD(1)),
    GraphQLType LowCardinality(String) CODEC(ZSTD(1)),
    Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),

    INDEX idx_id ID TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1
    INDEX idx_duration Duration TYPE minmax GRANULARITY 1
)
    engine = MergeTree PARTITION BY toDate(Timestamp)
        ORDER BY (MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
        TTL toDateTime(TimeUnix) + toIntervalDay(3)
        SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE cosmo.graphql_field_metrics;
