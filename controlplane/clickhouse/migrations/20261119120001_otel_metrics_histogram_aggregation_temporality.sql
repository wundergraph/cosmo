-- migrate:up

-- See 20261119120000_otel_metrics_sum_aggregation_temporality.sql for why this column is added.

ALTER TABLE cosmo.otel_metrics_histogram ADD COLUMN IF NOT EXISTS AggregationTemporality Int32 CODEC(ZSTD(1));

-- migrate:down

-- Intentionally empty: the collector writes this column, and on new installs it created it itself.
