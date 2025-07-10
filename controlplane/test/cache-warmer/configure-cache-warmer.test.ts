import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
} from '../../src/core/test-util.js';
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

  test('Should not be able to set the max operations count to more than 1000', async (testContext) => {
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
      maxOperationsCount: 500,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.OK);

    let cacheWarmerConfigResp = await client.getCacheWarmerConfig({
      namespace: 'default',
    });
    expect(cacheWarmerConfigResp.response?.code).toBe(EnumStatusCode.OK);
    expect(cacheWarmerConfigResp.isCacheWarmerEnabled).toBe(true);
    expect(cacheWarmerConfigResp.maxOperationsCount).toBe(500);

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

    configureCacheWarmerResp = await client.configureCacheWarmer({
      namespace: 'default',
      enableCacheWarmer: true,
      maxOperationsCount: 501,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(configureCacheWarmerResp.response?.details).toBe('Max operations count should be less than 500');

    cacheWarmerConfigResp = await client.getCacheWarmerConfig({
      namespace: 'default',
    });
    expect(cacheWarmerConfigResp.response?.code).toBe(EnumStatusCode.OK);
    expect(cacheWarmerConfigResp.isCacheWarmerEnabled).toBe(false);

    await server.close();
  });

  test.each([
    'organization-admin',
    'organization-developer',
  ])('%s should be able to enable and disable cache warmer', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      chClient,
      setupBilling: {
        plan: 'enterprise',
      },
    });

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
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

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not be able to configure cache warmer', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      chClient,
      setupBilling: {
        plan: 'enterprise',
      },
    });

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const configureCacheWarmerResp = await client.configureCacheWarmer({
      namespace: 'default',
      enableCacheWarmer: true,
      maxOperationsCount: 500,
    });
    expect(configureCacheWarmerResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });
});
