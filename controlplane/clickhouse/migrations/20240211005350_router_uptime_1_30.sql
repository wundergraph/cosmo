-- migrate:up

CREATE TABLE IF NOT EXISTS cosmo.router_uptime_1_30 (
   Timestamp DateTime('UTC') CODEC (Delta(4), ZSTD(3)),
   ProcessID String CODEC(ZSTD(3)),
   ConfigVersionID LowCardinality(String) CODEC(ZSTD(3)),
   OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
   FederatedGraphID LowCardinality(String) CODEC(ZSTD(3)),
   ServiceName LowCardinality(String) CODEC(ZSTD(3)),
   ServiceVersion LowCardinality(String) CODEC(ZSTD(3)),
   ServiceInstanceID String CODEC(ZSTD(3)),
   ClusterName LowCardinality(String) CODEC(ZSTD(3)),
   Hostname String CODEC(ZSTD(3)),
   UptimeSeconds BIGINT CODEC(ZSTD(3))
) ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
-- This allows us to fetch traces by federated graph in the most efficient way
ORDER BY (
    FederatedGraphID, OrganizationID, ConfigVersionID, ServiceInstanceID, toUnixTimestamp(Timestamp)
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.router_uptime_1_30