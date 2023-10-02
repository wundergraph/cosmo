-- migrate:up

CREATE FUNCTION func_rank_in_bucket_position as (rank,buckets) -> minus(rank,arrayElement(arrayCumSum(buckets),minus(func_rank_bucket_index(rank,buckets),1)))

-- migrate:down

DROP FUNCTION func_rank_in_bucket_position;
