import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SetupTest } from '../../test-util.js';
import { afterAllSetup, beforeAllSetup } from '../../../src/core/test-util.js';
import { ClickHouseClient } from '../../../src/core/clickhouse/index.js';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ROUTER_COMPATIBILITY_VERSIONS } from '@wundergraph/composition';



describe('router compatibility-version list tests', () => {
  let chClient: ClickHouseClient;
  let dbname = '';

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a list of supported router compatibility versions is returned', async () => {
    const { client } = await SetupTest({ dbname, chClient });
    const response = await client.listRouterCompatibilityVersions({});
    expect(response.response).toBeDefined();
    expect(response.response!.code).toBe(EnumStatusCode.OK);
    expect(response.versions).toStrictEqual([...ROUTER_COMPATIBILITY_VERSIONS]);
  })
});