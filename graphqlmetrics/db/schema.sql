
--
-- Database schema
--

CREATE DATABASE IF NOT EXISTS ckk2gqdo0qhgp8ogbqcg;

CREATE TABLE ckk2gqdo0qhgp8ogbqcg.graphql_operations
(
    `Timestamp` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    `OperationHash` LowCardinality(String) CODEC(ZSTD(1)),
    `OperationContent` String CODEC(ZSTD(1)),
    INDEX idx_operation_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_operation_content OperationContent TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1
)
ENGINE = ReplacingMergeTree(Timestamp)
PARTITION BY toDate(Timestamp)
ORDER BY OperationHash
TTL toDateTime(Timestamp) + toIntervalDay(90)
SETTINGS index_granularity = 512, ttl_only_drop_parts = 1;

CREATE TABLE ckk2gqdo0qhgp8ogbqcg.graphql_schema_field_usage_reports
(
    `Timestamp` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    `OrganizationID` LowCardinality(String) CODEC(ZSTD(1)),
    `FederatedGraphID` LowCardinality(String) CODEC(ZSTD(1)),
    `RouterConfigVersion` LowCardinality(String) CODEC(ZSTD(1)),
    `OperationHash` String CODEC(ZSTD(1)),
    `OperationType` LowCardinality(String) CODEC(ZSTD(1)),
    `Count` UInt64 CODEC(Delta(8), ZSTD(1)),
    `Path` Array(String) CODEC(ZSTD(1)),
    `TypeNames` Array(String) CODEC(ZSTD(1)),
    `Attributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    INDEX idx_operation_hash OperationHash TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_path Path TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_type_names TypeNames TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_count Count TYPE minmax GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (OrganizationID, FederatedGraphID, RouterConfigVersion, OperationHash, toUnixTimestamp(Timestamp))
TTL toDateTime(Timestamp) + toIntervalDay(3)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE ckk2gqdo0qhgp8ogbqcg.schema_migrations
(
    `version` String,
    `ts` DateTime DEFAULT now(),
    `applied` UInt8 DEFAULT 1
)
ENGINE = ReplacingMergeTree(ts)
PRIMARY KEY version
ORDER BY version
SETTINGS index_granularity = 8192;


--
-- Dbmate schema migrations
--

INSERT INTO schema_migrations (version) VALUES
    ('20231010143334'),
    ('20231011191834');
