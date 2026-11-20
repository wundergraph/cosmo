-- migrate:up

-- Span events (exceptions, "Downstream error N" with the subgraph's error code and message), so one trace's events
-- are read from this table instead of the raw otel_traces table. Spans stored before this migration have none.
ALTER TABLE cosmo.otel_spans_by_trace ADD COLUMN IF NOT EXISTS Events Nested(Timestamp DateTime64(9), Name LowCardinality(String), Attributes Map(LowCardinality(String), String)) CODEC(ZSTD(3));

-- migrate:down

ALTER TABLE cosmo.otel_spans_by_trace DROP COLUMN IF EXISTS Events;
