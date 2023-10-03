-- migrate:up

CREATE FUNCTION func_rank as (q,buckets) -> q*arraySum(buckets);

-- migrate:down

DROP FUNCTION func_rank;