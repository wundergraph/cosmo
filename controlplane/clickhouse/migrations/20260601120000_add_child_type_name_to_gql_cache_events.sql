-- migrate:up

-- ChildTypeName carries the named return type for FIELD_SELECTION events.
-- For Object accessors this is the unwrapped return type (e.g. 'Address');
-- for Array accessors it is the list element type (e.g. 'Hobby'). For
-- interface or union accessors the value is the abstract type name —
-- concrete __typename info already lives on the leaf FIELD_HASH rows under
-- the accessor. Empty for every other event type (FIELD_HASH, L1_READ,
-- etc.) and for old rows written before this column existed (ClickHouse
-- backfills empty for absent values on LowCardinality(String)).
ALTER TABLE gql_cache_events_raw
    ADD COLUMN IF NOT EXISTS ChildTypeName LowCardinality(String) CODEC(ZSTD(3));

-- migrate:down

ALTER TABLE gql_cache_events_raw
    DROP COLUMN IF EXISTS ChildTypeName;
