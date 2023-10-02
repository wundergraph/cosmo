-- migrate:up

CREATE FUNCTION func_histogram_v2 as (rank,rank_bound,buckets,bounds) ->
        rank_bound[1] + (rank_bound[2]-rank_bound[1])*
                        (func_rank_in_bucket_position(rank,buckets)/func_bucket_at(func_rank_bucket_index(rank,buckets),buckets))

-- migrate:down

DROP FUNCTION func_histogram_v2;

