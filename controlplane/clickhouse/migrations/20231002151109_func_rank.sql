-- migrate:up

CREATE FUNCTION func_rank as (q,buckets) -> arraySum(buckets) - ((1-q)*arraySum(buckets));

-- migrate:down

DROP FUNCTION func_rank;