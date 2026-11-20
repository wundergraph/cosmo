import { describe, expect, test } from 'vitest';
import { SamplingRatioRepository } from '../../src/core/repositories/analytics/SamplingRatioRepository.js';
import { fakeClickHouse } from './fake-clickhouse.js';

const scope = { organizationId: 'org-1', graphIds: ['g-prod'], window: { start: 30_000, end: 33_750 } };

describe('Observed sampling ratio', () => {
  const SAMPLED =
    "SELECT sum(greatest(toUInt64OrZero(SpanAttributes['wg.operation.batching.operations_count']), 1)) FROM cosmo.span_search WHERE OrganizationID = {organizationId:String} AND FederatedGraphID IN {graphIds:Array(String)} AND TimeBucket >= toStartOfFifteenMinutes(toDateTime({start:UInt32})) AND TimeBucket <= toStartOfFifteenMinutes(toDateTime({end:UInt32})) AND Timestamp >= toDateTime({start:UInt32}) AND Timestamp <= toDateTime({end:UInt32}) AND IsRoot AND OperationType != 'subscription'";

  test('counts every operation of a sampled batch from root spans alone, without subscriptions', async () => {
    const { client, queries, estimates } = fakeClickHouse(() => [{ sampled: '30', total: '900' }]);

    const sampling = await new SamplingRatioRepository(client).observe(scope, 1_000_000);

    expect(sampling).toEqual({ ratio: 0.0333 });
    expect(estimates.map((e) => e.sql)).toEqual([SAMPLED]);
    expect(queries.map((q) => q.sql)).toEqual([
      `SELECT (${SAMPLED}) AS sampled, (SELECT sum(TotalRequests) FROM cosmo.operation_request_metrics_5_30 WHERE OrganizationID = {organizationId:String} AND FederatedGraphID IN {graphIds:Array(String)} AND Timestamp >= toDateTime({start:UInt32}) AND Timestamp <= toDateTime({end:UInt32}) AND OperationType != 'subscription') AS total`,
    ]);
  });

  test('is left out, with a warning, when computing it would exceed the row budget', async () => {
    const { client, queries } = fakeClickHouse(
      () => [],
      () => 2_000_000,
    );

    expect(await new SamplingRatioRepository(client).observe(scope, 1_000_000)).toEqual({
      warning:
        'observedSamplingRatio is left out: computing it would read about 2,000,000 sampled spans (limit 1,000,000). Narrow the window to get it.',
    });
    expect(queries).toEqual([]);
  });
});
