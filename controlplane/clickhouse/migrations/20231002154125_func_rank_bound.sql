-- migrate:up

CREATE FUNCTION func_rank_bound as (rank,buckets,bounds) -> arraySlice(bounds,arrayFirstIndex(x -> if(x > rank, 1, 0),arrayCumSum(buckets)),2);

-- migrate:down

DROP FUNCTION func_rank_bound;

