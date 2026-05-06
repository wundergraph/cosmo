-- migrate:up

CREATE TABLE IF NOT EXISTS gql_cache_events_raw
(
    -- See https://github.com/PostHog/posthog/issues/10616 why ZSTD(3) is used
    Timestamp DateTime64(9, 'UTC') CODEC(Delta, ZSTD(3)),

    -- Tenant
    OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
    FederatedGraphID LowCardinality(String) CODEC(ZSTD(3)),
    RouterConfigVersion LowCardinality(String) CODEC(ZSTD(3)),

    -- Event discriminator. Canonical lowercase string. Values:
    --   'l1_read','l2_read','l1_write','l2_write','fetch_timing',
    --   'subgraph_error','shadow_comparison','mutation','header_impact',
    --   'cache_op_error'
    EventType LowCardinality(String) CODEC(ZSTD(3)),

    -- Operation context
    OperationHash LowCardinality(String) CODEC(ZSTD(3)),
    OperationName LowCardinality(String) CODEC(ZSTD(3)),
    OperationType LowCardinality(String) CODEC(ZSTD(3)),
    ClientName LowCardinality(String) CODEC(ZSTD(3)),
    ClientVersion LowCardinality(String) CODEC(ZSTD(3)),
    TraceID String CODEC(ZSTD(3)),
    IsShadow Bool CODEC(ZSTD(3)),

    -- Cache identity
    EntityType LowCardinality(String) CODEC(ZSTD(3)),
    SubgraphID LowCardinality(String) CODEC(ZSTD(3)),
    KeyHash UInt64 CODEC(ZSTD(3)),

    -- Field-level identity (root field for entity fetches; nested fields for value-type traversal)
    FieldName LowCardinality(String) CODEC(ZSTD(3)),
    FieldHash UInt64 CODEC(ZSTD(3)),
    FieldPath Array(LowCardinality(String)) CODEC(ZSTD(3)),
    EntityCount UInt32 CODEC(ZSTD(3)),
    EntityUniqueKeys UInt32 CODEC(ZSTD(3)),

    -- Read events (l1_read, l2_read)
    Verdict LowCardinality(String) CODEC(ZSTD(3)),
    ByteSize UInt32 CODEC(ZSTD(3)),
    CacheAgeMs UInt32 CODEC(ZSTD(3)),

    -- Write events (l1_write, l2_write)
    TTLMs UInt32 CODEC(ZSTD(3)),
    WriteReason LowCardinality(String) CODEC(ZSTD(3)),
    Source LowCardinality(String) CODEC(ZSTD(3)),

    -- Fetch timing
    FetchSource LowCardinality(String) CODEC(ZSTD(3)),
    DurationMs Float64 CODEC(ZSTD(3)),
    TTFBMs Float64 CODEC(ZSTD(3)),
    ItemCount UInt32 CODEC(ZSTD(3)),
    IsEntityFetch Bool CODEC(ZSTD(3)),
    HttpStatusCode UInt16 CODEC(ZSTD(3)),
    ResponseBytes UInt32 CODEC(ZSTD(3)),

    -- Errors (subgraph_error, cache_op_error)
    ErrorMessage String CODEC(ZSTD(3)),
    ErrorCode LowCardinality(String) CODEC(ZSTD(3)),
    CacheOp LowCardinality(String) CODEC(ZSTD(3)),
    CacheName LowCardinality(String) CODEC(ZSTD(3)),

    -- Shadow + mutation share these columns
    ShadowIsFresh Bool CODEC(ZSTD(3)),
    CachedHash UInt64 CODEC(ZSTD(3)),
    FreshHash UInt64 CODEC(ZSTD(3)),
    CachedBytes UInt32 CODEC(ZSTD(3)),
    FreshBytes UInt32 CODEC(ZSTD(3)),
    ConfiguredTTLMs UInt32 CODEC(ZSTD(3)),

    -- Mutation
    MutationRootField LowCardinality(String) CODEC(ZSTD(3)),
    HadCachedValue Bool CODEC(ZSTD(3)),
    IsStale Bool CODEC(ZSTD(3)),

    -- Header impact
    BaseKeyHash UInt64 CODEC(ZSTD(3)),
    HeaderHash UInt64 CODEC(ZSTD(3)),
    ResponseHash UInt64 CODEC(ZSTD(3)),

    INDEX idx_op_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_entity EntityType TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_subgraph SubgraphID TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_key_hash KeyHash TYPE bloom_filter(0.001) GRANULARITY 1
)
    engine = MergeTree PARTITION BY toDate(Timestamp)
        ORDER BY (OrganizationID, FederatedGraphID, EventType, OperationHash, EntityType, SubgraphID, toUnixTimestamp(Timestamp))
        TTL toDateTime(Timestamp) + toIntervalDay(7)
        SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1, non_replicated_deduplication_window = 1000;

-- migrate:down

DROP TABLE IF EXISTS gql_cache_events_raw;
