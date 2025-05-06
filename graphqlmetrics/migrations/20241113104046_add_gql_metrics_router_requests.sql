-- migrate:up

CREATE TABLE IF NOT EXISTS gql_metrics_router_requests
(
    -- See https://github.com/PostHog/posthog/issues/10616 why ZSTD(3) is used
    Timestamp DateTime('UTC') CODEC(Delta, ZSTD(3)),

    -- Organization
    OrganizationID LowCardinality(String) CODEC(ZSTD(3)),

    -- Router configuration
    FederatedGraphID LowCardinality(String) CODEC(ZSTD(3)),

    -- Count the number of requests made to the federated graph and organization over time
    RequestCount UInt64 CODEC(Delta, ZSTD(3))
)
    engine = SummingMergeTree PARTITION BY toDate(Timestamp)
        ORDER BY (FederatedGraphID, OrganizationID)
        -- keep the data for 90 days
        TTL toDateTime(Timestamp) + toIntervalDay(90)
        SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS gql_metrics_router_requests;