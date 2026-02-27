-- migrate:up

-- Drop func_histogram_v2 so it can be recreated with the corrected interpolation
-- in the next migration. See 20260227100342_recreate_func_histogram_v2_fix_interpolation.sql.

DROP FUNCTION func_histogram_v2;

-- migrate:down

-- Restore the original (buggy) func_histogram_v2.
-- The b > 1 interpolation fraction here (rank / cumSum[b]) is incorrect;
-- it was fixed in the following migration.

CREATE FUNCTION func_histogram_v2 as (rank,b,buckets,bounds) ->
    if(b = length(buckets), bounds[length(bounds)],
       if(b > 1,
          bounds[b-1] + (bounds[b]-bounds[b-1]) * (rank / arrayElement(arrayCumSum(buckets),b)),
          bounds[b] * (rank / arrayElement(arrayCumSum(buckets),b))
       )
    );
