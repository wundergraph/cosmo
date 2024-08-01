-- migrate:up

-- This table is used to store the uptime of the router service. It is used to store an optimized version of the uptime metric
-- We can use the FederatedGraphID as primary key which is the most efficient way to query data.
-- We only store last value of uptime sample for each service instance.
-- We can change this once we want to show historical uptime and persist router instances.

CREATE TABLE IF NOT EXISTS cosmo.router_uptime_30 (
   Timestamp SimpleAggregateFunction(max, DateTime('UTC')) CODEC (Delta(4), ZSTD(3)),
   ProcessID String CODEC(ZSTD(3)),
   ConfigVersionID LowCardinality(String) CODEC(ZSTD(3)),
   OrganizationID LowCardinality(String) CODEC(ZSTD(3)),
   FederatedGraphID LowCardinality(String) CODEC(ZSTD(3)),
   ServiceName LowCardinality(String) CODEC(ZSTD(3)),
   ServiceVersion LowCardinality(String) CODEC(ZSTD(3)),
   ServiceInstanceID String CODEC(ZSTD(3)),
   ClusterName LowCardinality(String) CODEC(ZSTD(3)),
   Hostname LowCardinality(String) CODEC(ZSTD(3)),
   ProcessUptimeSeconds SimpleAggregateFunction(max, BIGINT) CODEC(ZSTD(3))
) ENGINE = AggregatingMergeTree
PARTITION BY toDate(Timestamp)
-- This allows us to fetch traces by federated graph in the most efficient way
ORDER BY (
    -- A router is identified by the following fields. ServiceInstanceID must be unique.
    -- Set it to a stable value to group the uptime of the same service instance across restarts.
    FederatedGraphID, OrganizationID, ConfigVersionID,  ServiceInstanceID
)
TTL toDateTime(Timestamp) + toIntervalDay(30) SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- migrate:down

DROP TABLE IF EXISTS cosmo.router_uptime_30