-- migrate:up

CREATE FUNCTION func_rank_bound as (rank,bucketLowerIndex,buckets,bounds) -> arraySlice(bounds,bucketLowerIndex,2);

-- migrate:down

DROP FUNCTION func_rank_bound;

