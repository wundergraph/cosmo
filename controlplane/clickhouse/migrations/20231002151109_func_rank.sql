-- migrate:up

CREATE FUNCTION func_rank as (q,buckets) -> toUInt64(q*arraySum(buckets));

-- migrate:down

DROP FUNCTION func_rank;