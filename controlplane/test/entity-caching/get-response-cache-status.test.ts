import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, Mock, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ResponseCacheStatus } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { createThenPublishSubgraph, DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';

let dbname = '';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

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

    const createRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label)],
    });
    expect(createRes.response?.code).toBe(EnumStatusCode.OK);

    const ids: string[] = [];
    for (const name of names) {
      const res = await client.getSubgraphByName({ name, namespace: DEFAULT_NAMESPACE });
      ids.push(res.graph!.id);
    }
    const [deltaId, cumulativeId, idleId] = ids;

    (chClient.queryPromise as Mock).mockResolvedValue([
      { subgraphId: deltaId, cacheStatus: 'hit', totalFetches: '7', nonDeltaPoints: '0' },
      { subgraphId: deltaId, cacheStatus: 'miss', totalFetches: '3', nonDeltaPoints: '0' },
      // The router exports cumulative: no fetches are counted, but the subgraph must still be returned.
      { subgraphId: cumulativeId, cacheStatus: 'hit', totalFetches: '0', nonDeltaPoints: '12' },
      { subgraphId: idleId, cacheStatus: 'miss', totalFetches: '0', nonDeltaPoints: '0' },
    ]);

    const res = await client.getResponseCacheStatus({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.interval?.start).toBeTruthy();
    expect(res.interval?.end).toBeTruthy();
    expect(new Date(res.interval!.start).getTime()).toBeLessThan(new Date(res.interval!.end).getTime());
    expect(res.coverageCount).toBe(2);
    expect(res.subgraphs.map((s) => s.subgraphId)).toEqual([deltaId, cumulativeId]);

    const [delta, cumulative] = res.subgraphs;
    expect(delta.subgraphName).toBe(names[0]);
    expect(delta.totalFetches).toBe(BigInt(10));
    expect(delta.nonDeltaPoints).toBe(BigInt(0));
    expect(delta.statuses.map((s) => [s.cacheStatus, s.totalFetches])).toEqual([
      [ResponseCacheStatus.HIT, BigInt(7)],
      [ResponseCacheStatus.MISS, BigInt(3)],
    ]);

    expect(cumulative.subgraphName).toBe(names[1]);
    expect(cumulative.totalFetches).toBe(BigInt(0));
    expect(cumulative.nonDeltaPoints).toBe(BigInt(12));
  });

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
});
