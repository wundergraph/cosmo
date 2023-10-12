-- migrate:up

create table cosmo.graphql_operations
(
    Timestamp DateTime64(9) CODEC(Delta, ZSTD(1)),
    OperationHash LowCardinality(String) CODEC(ZSTD(1)),
    OperationContent String CODEC(ZSTD(1)),

    INDEX idx_operation_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_operation_content OperationContent TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1
)
    -- ReplacingMergeTree is used to avoid duplicates on the sorting key and keeps only the latest version
    -- https://altinity.com/blog/clickhouse-replacingmergetree-explained-the-good-the-bad-and-the-ugly
    -- Use FINAL as setting https://kb.altinity.com/engines/mergetree-table-engine-family/replacingmergetree/#final
    engine = ReplacingMergeTree(Timestamp) PARTITION BY toDate(Timestamp)
        ORDER BY (OperationHash)
        -- We store operations for 90 days
        TTL toDateTime(Timestamp) + toIntervalDay(90)
        -- Keep index_granularity low to avoid too many parts on disk which will slow down point queries
        -- MergeTree works with sparse indexes. The index can't point to specific row, but to the block of rows.
        SETTINGS index_granularity = 512, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE cosmo.graphql_operations;
