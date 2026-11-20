import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup } from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();
  ClickHouseClient.prototype.database = 'cosmo';
  return { ClickHouseClient };
});

let dbname = '';

describe('GetAnalyticsCapabilities', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('reports retention, sampling and the request limit from the plan', async (testContext) => {
    const { client, server } = await SetupTest({
      dbname,
      chClient: new ClickHouseClient(),
      setupBilling: { plan: 'scale@1' },
    });
    testContext.onTestFinished(() => server.close());

    const response = await client.getAnalyticsCapabilities({});

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(
      response.retention.map(({ family, planDays, storageTtlDays, effectiveDays }) => ({
        family,
        planDays,
        storageTtlDays,
        effectiveDays,
      })),
    ).toEqual([
      { family: 'tracing', planDays: 14, storageTtlDays: 30, effectiveDays: 14 },
      { family: 'analytics', planDays: 14, storageTtlDays: 30, effectiveDays: 14 },
      { family: 'schema_usage', planDays: 14, storageTtlDays: 90, effectiveDays: 14 },
      { family: 'request_volume', planDays: 14, storageTtlDays: 90, effectiveDays: 14 },
    ]);
    expect(response.traceSamplingRateLimit).toBe(0.3);
    expect(response.monthlyRequestLimit).toBe(BigInt(1_000_000_000));
    expect(response.isOrganizationAdmin).toBe(true);
    expect(response.analyticsEnabled).toBe(true);
    expect(Number.isNaN(Date.parse(response.now))).toBe(false);
  });

  test('reports analytics as disabled without ClickHouse', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient: undefined });
    testContext.onTestFinished(() => server.close());

    const response = await client.getAnalyticsCapabilities({});

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.analyticsEnabled).toBe(false);
  });
});
