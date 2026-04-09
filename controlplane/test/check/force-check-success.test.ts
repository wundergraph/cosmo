import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, createFederatedGraph, createSubgraph, SetupTest } from '../test-util.js';

let dbname = '';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('ForceCheckSuccess', () => {
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

  test('Should force a check to success', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String }',
    });

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Buffer.from('type Query { foo: String }'),
      skipTrafficCheck: true,
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

    const response = await client.forceCheckSuccess({
      graphName,
      namespace: DEFAULT_NAMESPACE,
      checkId: checkResp.checkId,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    // Verify the check is now marked as forced success
    const summaryResp = await client.getCheckSummary({
      checkId: checkResp.checkId,
      graphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(summaryResp.response?.code).toBe(EnumStatusCode.OK);
    expect(summaryResp.check?.isForcedSuccess).toBe(true);
  });

  test('Should fail when the graph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const response = await client.forceCheckSuccess({
      graphName: 'nonexistent',
      namespace: DEFAULT_NAMESPACE,
      checkId: '00000000-0000-0000-0000-000000000000',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain('Requested graph does not exist');
  });

  test('Should fail when the check does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const response = await client.forceCheckSuccess({
      graphName,
      namespace: DEFAULT_NAMESPACE,
      checkId: '00000000-0000-0000-0000-000000000000',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain('Requested check does not exist');
  });

  test.each(['organization-viewer', 'graph-viewer', 'subgraph-viewer'])(
    '%s should NOT be able to force a check to success',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });

      try {
        const graphName = genID('fedgraph');
        await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

        const subgraphName = genID('subgraph');
        await createSubgraph(client, subgraphName, 'http://localhost:4001');

        await client.publishFederatedSubgraph({
          name: subgraphName,
          namespace: DEFAULT_NAMESPACE,
          schema: 'type Query { hello: String }',
        });

        const checkResp = await client.checkSubgraphSchema({
          subgraphName,
          namespace: DEFAULT_NAMESPACE,
          schema: Buffer.from('type Query { foo: String }'),
          skipTrafficCheck: true,
        });
        expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

        const getGraphResponse = await client.getFederatedGraphByName({
          name: graphName,
          namespace: DEFAULT_NAMESPACE,
        });

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(
            createTestGroup({
              role,
              resources: [getGraphResponse.graph!.targetId],
            }),
          ),
        });

        const response = await client.forceCheckSuccess({
          graphName,
          namespace: DEFAULT_NAMESPACE,
          checkId: checkResp.checkId,
        });

        expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      } finally {
        await server.close();
      }
    },
  );
});
