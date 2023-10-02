-- migrate:up

CREATE FUNCTION func_bucket_at as (x,buckets) -> arrayElement(buckets,x)

-- migrate:down

DROP FUNCTION func_bucket_at;
