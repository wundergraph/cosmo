import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, createFederatedGraph, SetupTest } from '../test-util.js';

let dbname = '';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('GetRouters', () => {
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

  test('Should return empty list when no routers are active', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    // Mock clickhouse to return empty router list
    (chClient.queryPromise as any).mockResolvedValue([]);

    const response = await client.getRouters({
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.routers).toEqual([]);
  });

  test('Should return ERR_ANALYTICS_DISABLED when chClient is not configured', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const response = await client.getRouters({
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
    expect(response.routers).toEqual([]);
  });

  test('Should fail when the federated graph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const response = await client.getRouters({
      fedGraphName: 'nonexistent',
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain("Federated graph 'nonexistent' does not exist");
    expect(response.routers).toEqual([]);
  });

  test('Should return routers from ClickHouse', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    // Mock clickhouse to return some routers
    (chClient.queryPromise as any).mockResolvedValue([
      {
        hostname: 'router-1',
        clusterName: 'test-cluster',
        configVersionId: '',
        serviceName: 'cosmo-router',
        serviceVersion: '1.0.0',
        serviceInstanceId: 'instance-1',
        processUptimeSeconds: 100,
        processId: 'pid-1',
      },
    ]);

    const response = await client.getRouters({
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.routers.length).toBe(1);
    expect(response.routers[0].hostname).toBe('router-1');
    expect(response.routers[0].clusterName).toBe('test-cluster');
  });

  test.each(['organization-admin', 'organization-developer', 'organization-viewer', 'graph-admin', 'graph-viewer'])(
    '%s should be able to get routers',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const getGraphResponse = await client.getFederatedGraphByName({
        name: graphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(getGraphResponse.response?.code).toBe(EnumStatusCode.OK);

      (chClient.queryPromise as any).mockResolvedValue([]);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            resources: [getGraphResponse.graph!.targetId],
          }),
        ),
      });

      const response = await client.getRouters({
        fedGraphName: graphName,
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

      // Target graph we'll query
      const targetGraphName = genID('fedgraph');
      await createFederatedGraph(client, targetGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      // A different graph the user WILL be scoped to
      const otherGraphName = genID('other');
      await createFederatedGraph(client, otherGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8081');

      const otherGraphResponse = await client.getFederatedGraphByName({
        name: otherGraphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(otherGraphResponse.response?.code).toBe(EnumStatusCode.OK);

      (chClient.queryPromise as any).mockResolvedValue([]);

      // Scope the role only to the OTHER graph, not the target
      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            resources: [otherGraphResponse.graph!.targetId],
          }),
        ),
      });

      const response = await client.getRouters({
        fedGraphName: targetGraphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    },
  );
});
