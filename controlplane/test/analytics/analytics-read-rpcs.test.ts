import { afterAll, beforeAll, describe, expect, onTestFinished, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ANALYTICS_READ_RPCS } from '@wundergraph/cosmo-shared';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup } from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn().mockResolvedValue([]);
  ClickHouseClient.prototype.database = 'cosmo';
  return { ClickHouseClient };
});

const mcpHeaders = { headers: { 'x-cosmo-client': 'wgc-mcp/test' } };

let dbname = '';

describe('Analytics read RPCs', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test.each(ANALYTICS_READ_RPCS)('%s rate-limits MCP clients', async (rpc) => {
    const { client, server } = await SetupTest({
      dbname,
      chClient: new ClickHouseClient(),
      analyticsRateLimitPerMinute: 0,
    });
    onTestFinished(() => server.close());

    const response = await (client[rpc] as (req: object, opts: object) => Promise<any>)({}, mcpHeaders);

    expect(response.response?.code).toBe(EnumStatusCode.ERR_RATE_LIMITED);
  });

  test.each(ANALYTICS_READ_RPCS)('%s keeps the API key last-used time for everyone but MCP clients', async (rpc) => {
    const { client, server, authenticator } = await SetupTest({ dbname, chClient: new ClickHouseClient() });
    onTestFinished(() => server.close());
    const authenticate = vi.spyOn(authenticator, 'authenticate');
    const call = client[rpc] as (req: object, opts?: object) => Promise<unknown>;

    // Some handlers fail on an empty request after authenticating; only the authentication matters here.

    await call({}).catch(() => undefined);

    await call({}, mcpHeaders).catch(() => undefined);

    expect(authenticate.mock.calls.map(([, options]) => options)).toEqual([
      { skipApiKeyUsageUpdate: false },
      { skipApiKeyUsageUpdate: true },
    ]);
  });

  test('does not rate-limit requests without the MCP client header', async (testContext) => {
    const { client, server } = await SetupTest({
      dbname,
      chClient: new ClickHouseClient(),
      analyticsRateLimitPerMinute: 0,
    });
    testContext.onTestFinished(() => server.close());

    const response = await client.whoAmI({});

    expect(response.response?.code).toBe(EnumStatusCode.OK);
  });
});
