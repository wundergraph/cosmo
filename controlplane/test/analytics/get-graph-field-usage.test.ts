import { randomUUID } from 'node:crypto';
import { describe, expect, test, vi, beforeEach, afterEach, beforeAll, afterAll, onTestFinished } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { formatISO, subHours } from 'date-fns';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
  TestUser,
} from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, SetupTest, createFederatedGraph, createThenPublishSubgraph } from '../test-util.js';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

const HOUR_IN_SECONDS = 60 * 60;

const toUnixSeconds = (date: Date) => Math.round(date.getTime() / 1000);

const toDateRange = ({ start, end }: { start: number; end: number }) => ({
  start: new Date(start * 1000).toISOString(),
  end: new Date(end * 1000).toISOString(),
});

const readSubgraphId = async (client: Awaited<ReturnType<typeof SetupTest>>['client'], name: string) => {
  const { response, graph } = await client.getSubgraphByName({ name, namespace: DEFAULT_NAMESPACE });
  expect(response?.code).toBe(EnumStatusCode.OK);
  if (!graph) {
    throw new Error(`Subgraph '${name}' was not created`);
  }
  return graph.id;
};

const createGraph = async (client: Awaited<ReturnType<typeof SetupTest>>['client']) => {
  const fedGraphName = genID('fedGraph');
  const subgraphName = genID('subgraph');
  const label = genUniqueLabel();

  await createThenPublishSubgraph(
    client,
    subgraphName,
    DEFAULT_NAMESPACE,
    'type Query { hello: String! }',
    [label],
    'http://localhost:4001',
  );
  await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

  const { response, graph } = await client.getFederatedGraphByName({
    name: fedGraphName,
    namespace: DEFAULT_NAMESPACE,
  });
  expect(response?.code).toBe(EnumStatusCode.OK);
  if (!graph) {
    throw new Error(`Federated graph '${fedGraphName}' was not created`);
  }

  return { fedGraphName, subgraphName, graphId: graph.id, targetId: graph.targetId };
};

const readQuery = (chClient: ClickHouseClient) => {
  const { calls } = vi.mocked(chClient.queryPromise).mock;
  expect(calls).toHaveLength(1);
  const [query, params] = calls[0];
  return { query, params };
};

const readWindow = (chClient: ClickHouseClient) => {
  const { params } = readQuery(chClient);
  return { start: Number(params?.startDate), end: Number(params?.endDate) };
};

describe('GetGraphFieldUsage', () => {
  let chClient: ClickHouseClient;
  let dbname: string;

  beforeEach(() => {
    chClient = new ClickHouseClient();
    vi.clearAllMocks();
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

  test('Should return ERR_ANALYTICS_DISABLED when ClickHouse client is not available', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient: undefined });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);

    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
    expect(response.fields).toEqual([]);
  });

  test('Should return ERR_NOT_FOUND when federated graph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const fedGraphName = genID('nonExistentGraph');

    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain(`Federated graph '${fedGraphName}' not found`);
    expect(response.fields).toEqual([]);
    expect(chClient.queryPromise).not.toHaveBeenCalled();
  });

  test.each([
    ['a negative relative range', { range: -1 }],
    ['a zero relative range', { range: 0 }],
    ['unparseable explicit dates', { dateRange: { start: 'bad', end: 'bad' } }],
    ['an empty start date', { dateRange: { start: '', end: formatISO(new Date()) } }],
    [
      'reversed explicit dates',
      { dateRange: { start: formatISO(new Date()), end: formatISO(subHours(new Date(), 24)) } },
    ],
    [
      'reversed explicit dates with a relative range',
      { range: 24, dateRange: { start: formatISO(new Date()), end: formatISO(subHours(new Date(), 24)) } },
    ],
    [
      'explicit dates outside the retention with a relative range',
      {
        range: 24,
        dateRange: { start: formatISO(subHours(new Date(), 24 * 40)), end: formatISO(subHours(new Date(), 24 * 30)) },
      },
    ],
  ])('Should return ERR without querying ClickHouse for %s', async (_name, input) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);

    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      ...input,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Invalid date range');
    expect(response.fields).toEqual([]);
    expect(response.dateRange).toBeUndefined();
    expect(chClient.queryPromise).not.toHaveBeenCalled();
  });

  test('Should return empty fields when no usage exists', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);
    vi.mocked(chClient.queryPromise).mockResolvedValue([]);

    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.fields).toEqual([]);
  });

  test('Should return the request count of every field of the graph', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName, graphId } = await createGraph(client);

    // ClickHouse returns large sums as strings.
    vi.mocked(chClient.queryPromise).mockResolvedValue([
      { typeName: 'Employee', fieldName: 'id', subgraphIds: [], requestCount: '9007199254740993' },
      { typeName: 'Query', fieldName: 'employees', subgraphIds: [], requestCount: '42' },
    ]);

    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.fields).toHaveLength(2);
    expect(response.fields[0]?.typeName).toBe('Employee');
    expect(response.fields[0]?.fieldName).toBe('id');
    expect(response.fields[0]?.requestCount).toBe(BigInt('9007199254740993'));
    expect(response.fields[1]?.typeName).toBe('Query');
    expect(response.fields[1]?.fieldName).toBe('employees');
    expect(response.fields[1]?.requestCount).toBe(BigInt(42));

    const { query, params } = readQuery(chClient);
    expect(params?.organizationId).toBe(users.adminAliceCompanyA.organizationId);
    expect(params?.federatedGraphId).toBe(graphId);
    for (const fragment of [
      'toString(sum(TotalUsages)) AS requestCount',
      'ARRAY JOIN arrayDistinct(TypeNames)',
      'WHERE Timestamp >= startDate AND Timestamp <= endDate',
      'OrganizationID = {organizationId:String}',
      'FederatedGraphID = {federatedGraphId:String}',
      'IsArgument = false',
      'IsInput = false',
      'IsIndirectFieldUsage = false',
      'IsNull = false',
      'SubgraphIDs AS subgraphIds',
      'GROUP BY TypeName, FieldName, SubgraphIDs',
    ]) {
      expect(query).toContain(fragment);
    }
    expect(query).toMatch(/\.gql_metrics_schema_usage_5m_90d\s/);
  });

  test('Should return how often each subgraph resolved a field, counting a request resolved by several subgraphs for each', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName, subgraphName } = await createGraph(client);
    const otherSubgraphName = genID('subgraph');
    await createThenPublishSubgraph(
      client,
      otherSubgraphName,
      DEFAULT_NAMESPACE,
      'type Query { world: String! }',
      [genUniqueLabel()],
      'http://localhost:4002',
    );
    const subgraphId = await readSubgraphId(client, subgraphName);
    const otherSubgraphId = await readSubgraphId(client, otherSubgraphName);
    const deletedSubgraphId = randomUUID();

    vi.mocked(chClient.queryPromise).mockResolvedValue([
      { typeName: 'Employee', fieldName: 'details', subgraphIds: [subgraphId], requestCount: '10' },
      { typeName: 'Employee', fieldName: 'details', subgraphIds: [subgraphId, otherSubgraphId], requestCount: '5' },
      { typeName: 'Employee', fieldName: 'details', subgraphIds: [otherSubgraphId], requestCount: '2' },
      { typeName: 'Employee', fieldName: 'id', subgraphIds: [deletedSubgraphId], requestCount: '3' },
    ]);

    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(
      response.fields.map((field) => ({
        typeName: field.typeName,
        fieldName: field.fieldName,
        requestCount: field.requestCount,
        subgraphs: field.subgraphs.map((subgraph) => ({
          subgraphId: subgraph.subgraphId,
          subgraphName: subgraph.subgraphName,
          requestCount: subgraph.requestCount,
        })),
      })),
    ).toEqual([
      {
        typeName: 'Employee',
        fieldName: 'details',
        requestCount: BigInt(17),
        subgraphs: [
          { subgraphId, subgraphName, requestCount: BigInt(15) },
          { subgraphId: otherSubgraphId, subgraphName: otherSubgraphName, requestCount: BigInt(7) },
        ],
      },
      // A subgraph deleted since the requests has no name, so its counts are left out.
      { typeName: 'Employee', fieldName: 'id', requestCount: BigInt(3), subgraphs: [] },
    ]);
  });

  test('Should leave out subgraph ids that are not UUIDs, as a router config composed with wgc reports them', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName, subgraphName } = await createGraph(client);
    const subgraphId = await readSubgraphId(client, subgraphName);
    vi.mocked(chClient.queryPromise).mockResolvedValue([
      { typeName: 'Employee', fieldName: 'id', subgraphIds: ['0'], requestCount: '4' },
      { typeName: 'Employee', fieldName: 'id', subgraphIds: [subgraphId], requestCount: '6' },
    ]);

    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.fields[0]?.requestCount).toBe(BigInt(10));
    expect(
      response.fields[0]?.subgraphs.map((subgraph) => ({
        subgraphId: subgraph.subgraphId,
        requestCount: subgraph.requestCount,
      })),
    ).toEqual([{ subgraphId, requestCount: BigInt(6) }]);
  });

  test('Should use the last 24 hours when no range is given, and still return the retention of the plan', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);
    vi.mocked(chClient.queryPromise).mockResolvedValue([]);

    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.fields).toEqual([]);
    const { start, end } = readWindow(chClient);
    const queried = toDateRange(readWindow(chClient));
    expect(response.dateRange?.start).toBe(queried.start);
    expect(response.dateRange?.end).toBe(queried.end);
    expect(end - start).toBe(24 * HOUR_IN_SECONDS);
    expect(Math.abs(end - toUnixSeconds(new Date()))).toBeLessThanOrEqual(60);
    expect(response.analyticsRetentionInDays).toBe(7);
  });

  test('Should limit the range to seven days, and return that limit, when the organization has no plan', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);
    vi.mocked(chClient.queryPromise).mockResolvedValue([]);

    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      range: 30 * 24,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    const { start, end } = readWindow(chClient);
    const queried = toDateRange(readWindow(chClient));
    expect(response.dateRange?.start).toBe(queried.start);
    expect(response.dateRange?.end).toBe(queried.end);
    expect(end - start).toBe(7 * 24 * HOUR_IN_SECONDS);
    expect(response.analyticsRetentionInDays).toBe(7);
  });

  test('Should limit the range to the analytics retention of the plan, and return that retention', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient, setupBilling: { plan: 'scale@1' } });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);
    vi.mocked(chClient.queryPromise).mockResolvedValue([]);

    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      range: 30 * 24,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    const { start, end } = readWindow(chClient);
    const queried = toDateRange(readWindow(chClient));
    expect(response.dateRange?.start).toBe(queried.start);
    expect(response.dateRange?.end).toBe(queried.end);
    expect(end - start).toBe(14 * 24 * HOUR_IN_SECONDS);
    expect(response.analyticsRetentionInDays).toBe(14);
  });

  test('Should move the start of a date range to the analytics retention of the plan', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient, setupBilling: { plan: 'developer@1' } });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);
    vi.mocked(chClient.queryPromise).mockResolvedValue([]);

    const now = new Date();
    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      dateRange: {
        start: formatISO(subHours(now, 30 * 24)),
        end: formatISO(now),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    const { start, end } = readWindow(chClient);
    const queried = toDateRange(readWindow(chClient));
    expect(response.dateRange?.start).toBe(queried.start);
    expect(response.dateRange?.end).toBe(queried.end);
    expect(Math.abs(start - toUnixSeconds(subHours(now, 7 * 24)))).toBeLessThanOrEqual(60);
    expect(Math.abs(end - toUnixSeconds(now))).toBeLessThanOrEqual(60);
  });

  test.each([24, 0, -1])('Should use the date range and ignore a range of %i when both are given', async (range) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);
    vi.mocked(chClient.queryPromise).mockResolvedValue([]);

    const end = new Date(toUnixSeconds(new Date()) * 1000);
    const start = subHours(end, 2);
    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      range,
      dateRange: { start: formatISO(start), end: formatISO(end) },
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(readWindow(chClient)).toEqual({ start: toUnixSeconds(start), end: toUnixSeconds(end) });
    expect(response.dateRange?.start).toBe(start.toISOString());
    expect(response.dateRange?.end).toBe(end.toISOString());
  });

  test('Should query from the exact start of the date range, not the start of its time bucket', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);
    vi.mocked(chClient.queryPromise).mockResolvedValue([]);

    const end = new Date(toUnixSeconds(new Date()) * 1000);
    const start = subHours(end, 3);
    start.setUTCMinutes(2, 0, 0);
    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      dateRange: { start: formatISO(start), end: formatISO(end) },
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(readWindow(chClient).start).toBe(toUnixSeconds(start));
  });

  test('Should not return the graph of another organization', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({ dbname, chClient, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);

    authenticator.changeUser(TestUser.adminJimCompanyB);

    const response = await client.getGraphFieldUsage({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.fields).toEqual([]);
    expect(chClient.queryPromise).not.toHaveBeenCalled();
  });

  test.each(['organization-admin', 'organization-developer', 'organization-viewer', 'graph-admin', 'graph-viewer'])(
    '%s should be able to get graph field usage',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      onTestFinished(() => server.close());

      const { fedGraphName, targetId } = await createGraph(client);
      vi.mocked(chClient.queryPromise).mockResolvedValue([]);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role, resources: [targetId] })),
      });

      const response = await client.getGraphFieldUsage({
        federatedGraphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test.each(['graph-admin', 'graph-viewer', 'subgraph-admin', 'subgraph-viewer'])(
    '%s scoped to a different graph should NOT have access',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      onTestFinished(() => server.close());

      const { fedGraphName } = await createGraph(client);
      const { targetId: otherTargetId } = await createGraph(client);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role, resources: [otherTargetId] })),
      });

      const response = await client.getGraphFieldUsage({
        federatedGraphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      expect(chClient.queryPromise).not.toHaveBeenCalled();
    },
  );
});
