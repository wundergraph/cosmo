-- migrate:up

-- Source: https://github.com/prometheus/prometheus/blob/main/promql/quantile.go#L74

-- CREATE FUNCTION func_rank as (q,buckets) -> q*arraySum(buckets);
-- CREATE FUNCTION func_rank_bucket_lower_index as (rank,buckets) -> arrayFirstIndex(x -> if(x >= rank, 1, 0),arrayCumSum(buckets));

CREATE FUNCTION func_histogram_v2 as (rank,b,buckets,bounds) ->
    -- When +inf is matched, we return the last bucket's upper bound
    if(b = length(buckets), bounds[length(bounds)],
       if(b > 1,
          -- if the bucketLowerIndex is greater than 1, we interpolate between the lower and upper bounds of the bucket
          bounds[b] + (bounds[b+1] - bounds[b]) *
                          (minus(rank,arrayElement(arrayCumSum(buckets),minus(b,1))) /
                           minus(arrayElement(arrayCumSum(buckets),b), arrayElement(arrayCumSum(buckets), minus(b,1)))),
           -- else
          bounds[b+1] * (rank / arrayElement(arrayCumSum(buckets),b))
       )
    );

-- migrate:down

DROP FUNCTION func_histogram_v2;
