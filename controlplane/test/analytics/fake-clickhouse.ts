import type { Mock } from 'vitest';
import type { ClickHouseClient } from '../../src/core/clickhouse/index.js';

type Params = Record<string, unknown>;

/** A ClickHouse client that answers queries with `respond` and EXPLAIN ESTIMATE with `estimate`, recording both. */
export const fakeClickHouse = (
  respond: (sql: string, params: Params) => unknown[] = () => [],
  estimate: (sql: string, params: Params) => number = () => 0,
) => {
  const queries: { sql: string; params: Params }[] = [];
  const estimates: { sql: string; params: Params }[] = [];
  const client = {
    database: 'cosmo',
    queryPromise: (sql: string, params: Params) => {
      queries.push({ sql, params });
      return Promise.resolve(respond(sql, params));
    },
    estimateRows: (sql: string, params: Params) => {
      estimates.push({ sql, params });
      return Promise.resolve(estimate(sql, params));
    },
  } as unknown as ClickHouseClient;
  return { client, queries, estimates };
};

/** The queries a ClickHouseClient mocked with vi.mock received, in order. */
export const queryCalls = (chClient: ClickHouseClient) =>
  (chClient.queryPromise as Mock).mock.calls.map(([sql, params]) => ({ sql: sql as string, params }));
