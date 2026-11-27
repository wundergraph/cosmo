import { randomUUID } from 'node:crypto';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, Mock, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ResponseCacheStatus } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
  TestUser,
} from '../../src/core/test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { createFederatedGraph, createThenPublishSubgraph, DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';

let dbname = '';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

describe('GetResponseCacheStatus', () => {
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

  // Hub shows these totals per subgraph. Counts must stay exact past the JavaScript number limit, and subgraphs
  // with only cumulative data or with deleted metadata must still be shown.
  test('Should roll up per subgraph and leave out only subgraphs with no fetches and no non delta points', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel();
    const fedGraphName = genID('fedGraph');
    const names = [genID('a'), genID('b'), genID('c')];

    for (const [i, name] of names.entries()) {
      await createThenPublishSubgraph(
        client,
        name,
        DEFAULT_NAMESPACE,
        `type Query { f${i}: String! }`,
        [label],
        `http://localhost:${8081 + i}`,
      );
    }

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const ids: string[] = [];
    for (const name of names) {
      const res = await client.getSubgraphByName({ name, namespace: DEFAULT_NAMESPACE });
      ids.push(res.graph!.id);
    }
    const [deltaId, cumulativeId, idleId] = ids;
    const deletedId = randomUUID();
    // A router config composed with wgc numbers its subgraphs, and Postgres rejects a non-UUID id.
    const wgcComposedId = '0';

    (chClient.queryPromise as Mock).mockResolvedValue([
      {
        subgraphId: deltaId,
        cacheStatus: 'hit',
        totalFetches: '9007199254740993',
        nonDeltaPoints: '2',
        coverageCount: '3',
      },
      { subgraphId: deltaId, cacheStatus: 'miss', totalFetches: '2', nonDeltaPoints: '4', coverageCount: '3' },
      // The router exports cumulative: no fetches are counted, but the subgraph must still be returned.
      { subgraphId: cumulativeId, cacheStatus: 'hit', totalFetches: '0', nonDeltaPoints: '12', coverageCount: '2' },
      { subgraphId: idleId, cacheStatus: 'miss', totalFetches: '0', nonDeltaPoints: '0', coverageCount: '0' },
      { subgraphId: deletedId, cacheStatus: 'hit', totalFetches: '4', nonDeltaPoints: '0', coverageCount: '1' },
      { subgraphId: wgcComposedId, cacheStatus: 'miss', totalFetches: '5', nonDeltaPoints: '0', coverageCount: '1' },
    ]);

    const calledAt = Date.now();
    const res = await client.getResponseCacheStatus({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    const returnedAt = Date.now();

    expect(res.response?.code).toBe(EnumStatusCode.OK);

    const intervalStart = new Date(res.interval!.start).getTime();
    const intervalEnd = new Date(res.interval!.end).getTime();
    expect(intervalEnd - intervalStart).toBe(7 * ONE_DAY_MS);
    // The end may be rounded to a minute or a bucket boundary, so allow one bucket either side of the call.
    expect(intervalEnd).toBeGreaterThan(calledAt - FIVE_MINUTES_MS);
    expect(intervalEnd).toBeLessThan(returnedAt + FIVE_MINUTES_MS);

    expect(res.subgraphs.map((s) => s.subgraphId).sort()).toEqual(
      [deltaId, cumulativeId, deletedId, wgcComposedId].sort(),
    );

    const delta = res.subgraphs.find((s) => s.subgraphId === deltaId)!;
    expect(delta.subgraphName).toBe(names[0]);
    // A JavaScript number cannot hold this sum, so it fails if the counts are added as numbers.
    expect(delta.totalFetches).toBe(9_007_199_254_740_995n);
    expect(delta.nonDeltaPoints).toBe(6n);
    expect(delta.coverageCount).toBe(3);
    const deltaStatuses = delta.statuses.map(({ cacheStatus, totalFetches }) => ({ cacheStatus, totalFetches }));
    expect(deltaStatuses).toHaveLength(2);
    expect(deltaStatuses).toEqual(
      expect.arrayContaining([
        { cacheStatus: ResponseCacheStatus.HIT, totalFetches: 9_007_199_254_740_993n },
        { cacheStatus: ResponseCacheStatus.MISS, totalFetches: 2n },
      ]),
    );

    const cumulative = res.subgraphs.find((s) => s.subgraphId === cumulativeId)!;
    expect(cumulative.subgraphName).toBe(names[1]);
    expect(cumulative.totalFetches).toBe(0n);
    expect(cumulative.nonDeltaPoints).toBe(12n);

    expect(res.subgraphs.find((s) => s.subgraphId === deletedId)?.totalFetches).toBe(4n);
    expect(res.subgraphs.find((s) => s.subgraphId === wgcComposedId)?.totalFetches).toBe(5n);
  });

  // Hub needs a clear not found for a graph name that does not exist, and analytics must not be
  // queried for it.
  test('Should return not found for an unknown federated graph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const res = await client.getResponseCacheStatus({
      federatedGraphName: genID('missing'),
      namespace: DEFAULT_NAMESPACE,
    });

    expect(res.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(chClient.queryPromise).not.toHaveBeenCalled();
  });

  // Each plan allows a different amount of history. Hub must get the exact range when it is allowed,
  // only the allowed part when it crosses the limit, and an error when none of it is allowed.
  test('Should limit a window to the analytics retention of the plan', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient, setupBilling: { plan: 'scale@1' } });
    testContext.onTestFinished(() => server.close());

    const fedGraphName = genID('fedGraph');
    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');
    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const retentionMs = 14 * ONE_DAY_MS;
    const alignedDaysAgo = (days: number) =>
      Math.floor((Date.now() - days * ONE_DAY_MS) / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
    const query = (start: number, end: number) =>
      client.getResponseCacheStatus({
        federatedGraphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        dateRange: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
      });

    const inRangeStart = alignedDaysAgo(9);
    const inRangeEnd = alignedDaysAgo(8);
    const inRange = await query(inRangeStart, inRangeEnd);

    expect(inRange.response?.code).toBe(EnumStatusCode.OK);
    expect(inRange.interval?.start).toBe(new Date(inRangeStart).toISOString());
    expect(inRange.interval?.end).toBe(new Date(inRangeEnd).toISOString());
    expect(chClient.queryPromise).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({ start: inRangeStart / 1000, end: inRangeEnd / 1000 }),
    );

    const crossingStart = alignedDaysAgo(15);
    const crossingEnd = alignedDaysAgo(13);
    const calledAt = Date.now();
    const crossing = await query(crossingStart, crossingEnd);
    const returnedAt = Date.now();

    expect(crossing.response?.code).toBe(EnumStatusCode.OK);
    const effectiveStart = new Date(crossing.interval!.start).getTime();
    // The cutoff is read during the call and cut to whole seconds, so it can be at most 999 ms before calledAt minus 14 days.
    expect(effectiveStart).toBeGreaterThanOrEqual(Math.floor((calledAt - retentionMs) / 1000) * 1000);
    expect(effectiveStart).toBeLessThan(returnedAt - retentionMs + FIVE_MINUTES_MS);
    expect(crossing.interval?.end).toBe(new Date(crossingEnd).toISOString());
    expect(chClient.queryPromise).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ start: effectiveStart / 1000, end: crossingEnd / 1000 }),
    );

    const outside = await query(alignedDaysAgo(17), alignedDaysAgo(16));

    expect(outside.response?.code).toBe(EnumStatusCode.ERR);
    expect(chClient.queryPromise).toHaveBeenCalledTimes(2);
  });

  // A range that ends before it starts is a caller mistake. Hub must get an error, not numbers for
  // a range nobody selected.
  test('Should reject a date range whose start is after its end without querying analytics', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const fedGraphName = genID('fedGraph');
    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');
    const now = Date.now();

    const res = await client.getResponseCacheStatus({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      dateRange: {
        start: new Date(now - ONE_HOUR_MS).toISOString(),
        end: new Date(now - 2 * ONE_HOUR_MS).toISOString(),
      },
    });

    expect(res.response?.code).toBe(EnumStatusCode.ERR);
    expect(chClient.queryPromise).not.toHaveBeenCalled();
  });

  // Self-hosted setups can run without ClickHouse. Hub must get a clear "analytics disabled" error
  // instead of a crash.
  test('Should report analytics disabled when no ClickHouse client is configured', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const res = await client.getResponseCacheStatus({
      federatedGraphName: genID('fedGraph'),
      namespace: DEFAULT_NAMESPACE,
    });

    expect(res.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
  });

  // Cache numbers belong to the graph. A user who cannot read the graph must not see them, so the check
  // must run before analytics is queried.
  test('Should deny a caller without read access to the federated graph without querying analytics', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname, chClient, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const fedGraphName = genID('fedGraph');
    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.viewerTimCompanyA]!,
      rbac: createTestRBACEvaluator(createTestGroup({ role: 'namespace-viewer' })),
    });

    const res = await client.getResponseCacheStatus({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(res.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(chClient.queryPromise).not.toHaveBeenCalled();
  });
});
