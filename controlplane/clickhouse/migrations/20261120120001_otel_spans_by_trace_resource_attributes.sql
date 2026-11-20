-- migrate:up

-- Resource attributes of the process that emitted the span: host, router version, instance ID, pid, `wg.is_plugin`.
ALTER TABLE cosmo.otel_spans_by_trace ADD COLUMN IF NOT EXISTS ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(3));

-- migrate:down

ALTER TABLE cosmo.otel_spans_by_trace DROP COLUMN IF EXISTS ResourceAttributes;
