-- migrate:up

CREATE FUNCTION func_rank_bucket_index as (rank,buckets) -> arrayFirstIndex(x -> if(x > rank, 1, 0),arrayCumSum(buckets));

-- migrate:down

DROP FUNCTION func_rank_bucket_index;