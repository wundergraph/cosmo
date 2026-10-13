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

const createGraph = async (client: Awaited<ReturnType<typeof SetupTest>>['client']) => {
  const fedGraphName = genID('fedGraph');
  const label = genUniqueLabel();

  await createThenPublishSubgraph(
    client,
    genID('subgraph'),
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

  return { fedGraphName, graphId: graph.id, targetId: graph.targetId };
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

  const lastQuery = () => {
    const { calls } = vi.mocked(chClient.queryPromise).mock;
    expect(calls).toHaveLength(1);
    const [query, params] = calls[0];
    return { query, params };
  };

  const lastWindow = () => {
    const { params } = lastQuery();
    return { start: Number(params?.startDate), end: Number(params?.endDate) };
  };

  test('Should return ERR_ANALYTICS_DISABLED when ClickHouse client is not available', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient: undefined });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);

    const response = await client.getGraphFieldUsage({ graphName: fedGraphName, namespace: DEFAULT_NAMESPACE });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
    expect(response.fields).toEqual([]);
  });

  test('Should return ERR_NOT_FOUND when federated graph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const fedGraphName = genID('nonExistentGraph');

    const response = await client.getGraphFieldUsage({ graphName: fedGraphName, namespace: DEFAULT_NAMESPACE });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toBe(`Federated graph '${fedGraphName}' not found`);
    expect(response.fields).toEqual([]);
    expect(chClient.queryPromise).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: 'a date range that starts after it ends',
      range: undefined,
      start: formatISO(new Date()),
      end: formatISO(subHours(new Date(), 24)),
    },
    {
      name: 'a date range that ends before the retention window',
      range: undefined,
      start: formatISO(subHours(new Date(), 61 * 24)),
      end: formatISO(subHours(new Date(), 60 * 24)),
    },
    {
      name: 'a date range that ends before the retention window when a range is also given',
      range: 1,
      start: formatISO(subHours(new Date(), 61 * 24)),
      end: formatISO(subHours(new Date(), 60 * 24)),
    },
    {
      name: 'a date range whose start is not a date',
      range: undefined,
      start: 'not-a-date',
      end: formatISO(new Date()),
    },
    { name: 'a date range whose end is not a date', range: undefined, start: formatISO(new Date()), end: 'not-a-date' },
    { name: 'an empty date range', range: undefined, start: '', end: '' },
    { name: 'a negative range', range: -5, start: undefined, end: undefined },
    { name: 'a zero range', range: 0, start: undefined, end: undefined },
  ])('Should return ERR for $name', async ({ range, start, end }) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);

    const response = await client.getGraphFieldUsage({
      graphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      range,
      dateRange: start === undefined || end === undefined ? undefined : { start, end },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Invalid date range');
    expect(response.fields).toEqual([]);
    expect(response.dateRange).toBeUndefined();
    expect(chClient.queryPromise).not.toHaveBeenCalled();
  });

  test('Should return the request count of every field of the graph', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName, graphId } = await createGraph(client);

    // ClickHouse returns large sums as strings.
    vi.mocked(chClient.queryPromise).mockResolvedValue([
      { typeName: 'Employee', fieldName: 'id', requestCount: '9007199254740993' },
      { typeName: 'Query', fieldName: 'employees', requestCount: '42' },
    ]);

    const response = await client.getGraphFieldUsage({ graphName: fedGraphName, namespace: DEFAULT_NAMESPACE });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.fields).toHaveLength(2);
    expect(response.fields[0]?.typeName).toBe('Employee');
    expect(response.fields[0]?.fieldName).toBe('id');
    expect(response.fields[0]?.requestCount).toBe(BigInt('9007199254740993'));
    expect(response.fields[1]?.typeName).toBe('Query');
    expect(response.fields[1]?.fieldName).toBe('employees');
    expect(response.fields[1]?.requestCount).toBe(BigInt(42));

    const { query, params } = lastQuery();
    expect(params).toMatchObject({
      organizationId: users.adminAliceCompanyA.organizationId,
      federatedGraphId: graphId,
    });
    for (const fragment of [
      'sum(TotalUsages) AS requestCount',
      'ARRAY JOIN arrayDistinct(TypeNames)',
      'WHERE Timestamp >= startDate AND Timestamp <= endDate',
      'OrganizationID = {organizationId:String}',
      'FederatedGraphID = {federatedGraphId:String}',
      'IsArgument = false',
      'IsInput = false',
      'IsIndirectFieldUsage = false',
      'IsNull = false',
      'GROUP BY TypeName, FieldName',
    ]) {
      expect(query).toContain(fragment);
    }
    expect(query).toMatch(/\.gql_metrics_schema_usage_5m_90d\s/);
  });

  test('Should use the last 24 hours when no range is given', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);
    vi.mocked(chClient.queryPromise).mockResolvedValue([]);

    const response = await client.getGraphFieldUsage({ graphName: fedGraphName, namespace: DEFAULT_NAMESPACE });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.fields).toEqual([]);
    const { start, end } = lastWindow();
    expect(response.dateRange).toMatchObject(toDateRange(lastWindow()));
    expect(end - start).toBe(24 * HOUR_IN_SECONDS);
    expect(Math.abs(end - toUnixSeconds(new Date()))).toBeLessThanOrEqual(60);
  });

  test('Should limit the range to seven days when the organization has no plan', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);
    vi.mocked(chClient.queryPromise).mockResolvedValue([]);

    const response = await client.getGraphFieldUsage({
      graphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      range: 30 * 24,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    const { start, end } = lastWindow();
    expect(response.dateRange).toMatchObject(toDateRange(lastWindow()));
    expect(end - start).toBe(7 * 24 * HOUR_IN_SECONDS);
  });

  test('Should limit the range to the analytics retention of the plan', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient, setupBilling: { plan: 'scale@1' } });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);
    vi.mocked(chClient.queryPromise).mockResolvedValue([]);

    const response = await client.getGraphFieldUsage({
      graphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      range: 30 * 24,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    const { start, end } = lastWindow();
    expect(response.dateRange).toMatchObject(toDateRange(lastWindow()));
    expect(end - start).toBe(14 * 24 * HOUR_IN_SECONDS);
  });

  test('Should move the start of a date range to the analytics retention of the plan', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient, setupBilling: { plan: 'developer@1' } });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);
    vi.mocked(chClient.queryPromise).mockResolvedValue([]);

    const now = new Date();
    const response = await client.getGraphFieldUsage({
      graphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      dateRange: {
        start: formatISO(subHours(now, 30 * 24)),
        end: formatISO(now),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    const { start, end } = lastWindow();
    expect(response.dateRange).toMatchObject(toDateRange(lastWindow()));
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
      graphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      range,
      dateRange: { start: formatISO(start), end: formatISO(end) },
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(lastWindow()).toEqual({ start: toUnixSeconds(start), end: toUnixSeconds(end) });
    expect(response.dateRange).toMatchObject({ start: start.toISOString(), end: end.toISOString() });
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
      graphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      dateRange: { start: formatISO(start), end: formatISO(end) },
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(lastWindow().start).toBe(toUnixSeconds(start));
  });

  test('Should not return the graph of another organization', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({ dbname, chClient, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);

    authenticator.changeUser(TestUser.adminJimCompanyB);

    const response = await client.getGraphFieldUsage({ graphName: fedGraphName, namespace: DEFAULT_NAMESPACE });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.fields).toEqual([]);
    expect(chClient.queryPromise).not.toHaveBeenCalled();
  });

  test('Should deny a role that cannot read federated graphs', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const { fedGraphName } = await createGraph(client);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role: 'subgraph-publisher' })),
    });

    const response = await client.getGraphFieldUsage({ graphName: fedGraphName, namespace: DEFAULT_NAMESPACE });

    expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(chClient.queryPromise).not.toHaveBeenCalled();
  });

  test.each(['organization-admin', 'organization-developer', 'organization-viewer', 'graph-admin', 'graph-viewer'])(
    '%s scoped to the graph should be able to read its field usage',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      onTestFinished(() => server.close());

      const { fedGraphName, targetId } = await createGraph(client);
      vi.mocked(chClient.queryPromise).mockResolvedValue([]);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role, resources: [targetId] })),
      });

      const response = await client.getGraphFieldUsage({ graphName: fedGraphName, namespace: DEFAULT_NAMESPACE });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test.each(['graph-admin', 'graph-viewer'])(
    '%s scoped to a different graph should not be able to read its field usage',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      onTestFinished(() => server.close());

      const { fedGraphName } = await createGraph(client);
      const { targetId: otherTargetId } = await createGraph(client);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role, resources: [otherTargetId] })),
      });

      const response = await client.getGraphFieldUsage({ graphName: fedGraphName, namespace: DEFAULT_NAMESPACE });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      expect(chClient.queryPromise).not.toHaveBeenCalled();
    },
  );
});
