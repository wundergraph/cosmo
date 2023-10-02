-- migrate:up

-- CREATE FUNCTION func_rank as (q,buckets) -> toUInt64(q*arraySum(buckets));
-- CREATE FUNCTION func_rank_bucket_lower_index as (rank,buckets) -> arrayFirstIndex(x -> if(x > rank, 1, 0),arrayCumSum(buckets));
-- CREATE FUNCTION func_rank_bound as (rank,bucketLowerIndex,buckets,bounds) -> arraySlice(bounds,bucketLowerIndex,2);
-- CREATE FUNCTION func_rank_in_bucket_position as (rank,bucketLowerIndex,buckets) -> minus(rank,arrayElement(arrayCumSum(buckets),minus(bucketLowerIndex,1)))

CREATE FUNCTION func_histogram_v2 as (rank,bucketLowerIndex,rank_bound,buckets,bounds) ->
    -- When +inf is the lowest bound, we return the last bucket's upper bound
    if(bucketLowerIndex = length(buckets), bounds[length(bounds)],
       -- else
       rank_bound[1] + (rank_bound[2] - rank_bound[1]) *
                       (func_rank_in_bucket_position(rank, bucketLowerIndex, buckets) /
                        arrayElement(buckets, bucketLowerIndex))
    )

-- migrate:down

DROP FUNCTION func_histogram_v2;
