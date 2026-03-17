-- migrate:up

-- Recreates func_histogram_v2 with the corrected Prometheus bucket_quantile interpolation.
--
-- These three functions together implement the Prometheus bucket_quantile algorithm:
--   1. func_rank(q, buckets)                        -> rank = q * total
--   2. func_rank_bucket_lower_index(rank, buckets)   -> b = first bucket where cumSum >= rank
--   3. func_histogram_v2(rank, b, buckets, bounds)   -> interpolated quantile value
--
-- Parameters:
--   rank    = target count position (from func_rank)
--   b       = 1-indexed bucket containing the rank (from func_rank_bucket_lower_index)
--   buckets = per-bucket counts (non-cumulative), length N+1 (includes +inf bucket)
--   bounds  = explicit histogram boundaries, length N (excludes +inf)
--
-- The Prometheus interpolation formula for b > 1 is:
--   bucketStart + (bucketEnd - bucketStart) * (rank - cumSum[b-1]) / (cumSum[b] - cumSum[b-1])
--
-- Bug: The previous implementation used rank / cumSum[b] as the interpolation fraction,
-- which uses the absolute rank instead of the rank relative to the bucket start.
-- This caused quantile values to be systematically over-estimated for all buckets past
-- the first, with increasing error for higher percentiles (p90, p95, p99).
--
-- Example with buckets=[10,20,30], cumSum=[10,30,60], q=0.75, rank=45, b=3:
--   Before (wrong): fraction = 45 / 60           = 0.75
--   After (correct): fraction = (45-30) / (60-30) = 0.50
--
-- Source: https://github.com/prometheus/prometheus/blob/79be1b835789d7c3fde2a907003a8799c308733f/promql/quantile.go#L74

CREATE FUNCTION func_histogram_v2 as (rank,b,buckets,bounds) ->
    if(b = length(buckets),
       -- Case 1: rank falls in the +inf bucket, return the last finite bound
       bounds[length(bounds)],
       if(b > 1,
          -- Case 2: interpolate within bucket b using the Prometheus formula:
          --   lowerBound + (upperBound - lowerBound) * (rank - cumSum[b-1]) / (cumSum[b] - cumSum[b-1])
          bounds[b-1] + (bounds[b]-bounds[b-1]) *
              (minus(rank, arrayElement(arrayCumSum(buckets), minus(b, 1))) /
               minus(arrayElement(arrayCumSum(buckets), b), arrayElement(arrayCumSum(buckets), minus(b, 1)))),
          -- Case 3: first bucket (b=1), lower bound is 0:
          --   upperBound * (rank / cumSum[1])
          bounds[b] * (rank / arrayElement(arrayCumSum(buckets),b))
       )
    );

-- migrate:down

DROP FUNCTION func_histogram_v2;
