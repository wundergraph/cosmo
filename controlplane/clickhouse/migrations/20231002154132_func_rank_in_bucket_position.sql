-- migrate:up

CREATE FUNCTION func_rank_in_bucket_position as (rank,bucketLowerIndex,buckets) -> minus(rank,arrayElement(arrayCumSum(buckets),minus(bucketLowerIndex,1)))

-- migrate:down

DROP FUNCTION func_rank_in_bucket_position;
