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

    -- Indicates if the usage was from an argument or a field
    IsArgument bool CODEC(ZSTD(3)),

    -- Indicates if the usage was from an input field
    IsInput bool CODEC(ZSTD(3)),

    -- Additional information
    Attributes Map(LowCardinality(String), String) CODEC(ZSTD(3)),

    IsIndirectFieldUsage bool DEFAULT false
)
    -- The Null table engine is a powerful optimization - think of it as /dev/null.
    -- When data is inserted into the Null table, it is immediately discarded but materialized views are still updated.
    -- This is useful for cases where you want to track metrics but don't need to store the raw data.
    engine = Null;

-- migrate:down

DROP TABLE IF EXISTS gql_metrics_schema_usage;

