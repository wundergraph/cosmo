import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup } from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';

let dbname = '';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('DeleteCacheOperation', (ctx) => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to enable and disable cache warmer.', async (testContext) => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: {
        plan: 'enterprise',
      },
    });

    let configureCacheWarmerResp = await client.configureCacheWarmer({
      namespace: 'default',
      enableCacheWarmer: true,
      maxOperationsCount: 100,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    let cacheWarmerConfigResp = await client.getCacheWarmerConfig({
      namespace: 'default',
    });
    expect(cacheWarmerConfigResp.response?.code).toBe(EnumStatusCode.OK);
    expect(cacheWarmerConfigResp.isCacheWarmerEnabled).toBe(true);
    expect(cacheWarmerConfigResp.maxOperationsCount).toBe(100);

    configureCacheWarmerResp = await client.configureCacheWarmer({
      namespace: 'default',
      enableCacheWarmer: false,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    cacheWarmerConfigResp = await client.getCacheWarmerConfig({
      namespace: 'default',
    });
    expect(cacheWarmerConfigResp.response?.code).toBe(EnumStatusCode.OK);
    expect(cacheWarmerConfigResp.isCacheWarmerEnabled).toBe(false);

    await server.close();
  });

  test('Should not able to change the maximum operations count.', async (testContext) => {
    const { client, server } = await SetupTest({
      dbname,
      chClient,
      setupBilling: {
        plan: 'enterprise',
      },
    });

    let configureCacheWarmerResp = await client.configureCacheWarmer({
      namespace: 'default',
      enableCacheWarmer: true,
      maxOperationsCount: 100,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    let cacheWarmerConfigResp = await client.getCacheWarmerConfig({
      namespace: 'default',
    });
    expect(cacheWarmerConfigResp.response?.code).toBe(EnumStatusCode.OK);
    expect(cacheWarmerConfigResp.isCacheWarmerEnabled).toBe(true);
    expect(cacheWarmerConfigResp.maxOperationsCount).toBe(100);

    configureCacheWarmerResp = await client.configureCacheWarmer({
      namespace: 'default',
      enableCacheWarmer: true,
      maxOperationsCount: 200,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    cacheWarmerConfigResp = await client.getCacheWarmerConfig({
      namespace: 'default',
    });
    expect(cacheWarmerConfigResp.response?.code).toBe(EnumStatusCode.OK);
    expect(cacheWarmerConfigResp.isCacheWarmerEnabled).toBe(true);
    expect(cacheWarmerConfigResp.maxOperationsCount).toBe(200);

    configureCacheWarmerResp = await client.configureCacheWarmer({
      namespace: 'default',
      enableCacheWarmer: false,
      maxOperationsCount: 100,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    cacheWarmerConfigResp = await client.getCacheWarmerConfig({
      namespace: 'default',
    });
    expect(cacheWarmerConfigResp.response?.code).toBe(EnumStatusCode.OK);
    expect(cacheWarmerConfigResp.isCacheWarmerEnabled).toBe(false);
    expect(cacheWarmerConfigResp.maxOperationsCount).toBe(0);

    await server.close();
  });
});
