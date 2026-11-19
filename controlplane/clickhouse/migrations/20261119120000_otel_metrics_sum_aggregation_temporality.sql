-- migrate:up

-- The ClickHouse exporter in otelcollector >= 0.104 writes an `AggregationTemporality` column to the
-- sum, histogram and exponential histogram tables. Tables created by older collectors do not have it
-- (the sum table has `AggTemp` instead), so every insert into them fails after the upgrade.
--
-- We add the column instead of renaming `AggTemp`. This way the old and the new collector can both
-- write while they run side by side during a rollout, and the migration order does not matter.
-- No view reads either column. On tables created by a new collector, these statements do nothing.

ALTER TABLE cosmo.otel_metrics_sum ADD COLUMN IF NOT EXISTS AggregationTemporality Int32 CODEC(ZSTD(1));

-- migrate:down

-- Intentionally empty: the collector writes this column, and on new installs it created it itself.
