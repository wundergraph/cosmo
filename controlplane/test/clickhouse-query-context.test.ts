import { beforeEach, describe, expect, Mock, test, vi } from 'vitest';
import axios from 'axios';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { clickHouseQueryContext, setQueryContextActor } from '../src/core/clickhouse/queryContext.js';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, request: vi.fn() } };
});

describe('ClickHouse query context', () => {
  let client: ClickHouseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    (axios.request as Mock).mockResolvedValue({ data: '{"data":[]}' });
    client = new ClickHouseClient({ dsn: 'http://localhost:8123?database=cosmo' });
  });

  test('sends log_comment and query_id for queries made inside a request', async () => {
    await clickHouseQueryContext.run({ rpc: 'GetTrace', client: 'wgc-mcp/1.0.0' }, async () => {
      setQueryContextActor('org1', 'user1');
      await client.queryPromise('SELECT 1');
    });

    const params = (axios.request as Mock).mock.calls[0][0].params as URLSearchParams;
    expect(params.get('log_comment')).toBe(
      '{"rpc":"GetTrace","organizationId":"org1","actorId":"user1","client":"wgc-mcp/1.0.0"}',
    );
    expect(params.get('query_id')).toMatch(/^GetTrace-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/);
  });

  test('sends neither param outside a request', async () => {
    await client.queryPromise('SELECT 1');

    const params = (axios.request as Mock).mock.calls[0][0].params as URLSearchParams;
    expect(params.get('log_comment')).toBe(null);
    expect(params.get('query_id')).toBe(null);
  });

  test('forwards the request abort signal to axios', async () => {
    const controller = new AbortController();
    await clickHouseQueryContext.run({ rpc: 'GetTrace', signal: controller.signal }, async () => {
      await client.queryPromise('SELECT 1');
    });

    expect((axios.request as Mock).mock.calls[0][0].signal).toBe(controller.signal);
  });

  test('setQueryContextActor outside a request is a no-op', () => {
    expect(() => setQueryContextActor('org1')).not.toThrow();
  });
});
