import { Client } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  type Mock,
  vi,
} from 'vitest';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
} from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';

let dbname = '';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

/**
 * Sets up a federated graph, subgraph, and runs a check that generates breaking changes,
 * then returns the checkId and graph info needed by operation override tests.
 */
async function setupCheckWithBreakingChanges(client: Client<typeof PlatformService>, chClient: ClickHouseClient) {
  const fedGraphName = genID('fedGraph');
  const subgraphName = genID('subgraph');
  const label = genUniqueLabel();

  const initSchema = `type Query { employees: [Employee!]! } type Employee { id: Int! }`;
  const modifiedSchema = `type Query { employees: [Employee] } type Employee { id: Int! }`;

  const createFedGraphRes = await client.createFederatedGraph({
    name: fedGraphName,
    namespace: DEFAULT_NAMESPACE,
    routingUrl: 'http://localhost:8081',
    labelMatchers: [joinLabel(label)],
  });
  expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

  const createSubgraphRes = await client.createFederatedSubgraph({
    name: subgraphName,
    namespace: DEFAULT_NAMESPACE,
    labels: [label],
    routingUrl: 'http://localhost:8081',
  });
  expect(createSubgraphRes.response?.code).toBe(EnumStatusCode.OK);

  const publishResp = await client.publishFederatedSubgraph({
    name: subgraphName,
    namespace: DEFAULT_NAMESPACE,
    schema: initSchema,
  });
  expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

  // Mock clickhouse to return some operations
  (chClient.queryPromise as Mock).mockResolvedValue([
    {
      operationHash: 'hash1',
      operationName: 'op1',
      operationType: 'query',
      firstSeen: Date.now() / 1000,
      lastSeen: Date.now() / 1000,
    },
  ]);

  const checkResp = await client.checkSubgraphSchema({
    subgraphName,
    namespace: DEFAULT_NAMESPACE,
    schema: Buffer.from(modifiedSchema),
  });
  expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

  return {
    fedGraphName,
    subgraphName,
    checkId: checkResp.checkId,
  };
}

describe('Operation Overrides', () => {
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

  describe('createIgnoreOverridesForAllOperations', () => {
    test('Should create ignore overrides for affected operations', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const { fedGraphName, checkId } = await setupCheckWithBreakingChanges(client, chClient);

      const response = await client.createIgnoreOverridesForAllOperations({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        checkId,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      // Verify the ignore override was created
      const overridesResp = await client.getOperationOverrides({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        operationHash: 'hash1',
      });
      expect(overridesResp.response?.code).toBe(EnumStatusCode.OK);
      expect(overridesResp.ignoreAll).toBe(true);
    });

    test('Should fail when graph does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const response = await client.createIgnoreOverridesForAllOperations({
        graphName: 'nonexistent',
        namespace: DEFAULT_NAMESPACE,
        checkId: '00000000-0000-0000-0000-000000000000',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(response.response?.details).toContain('Requested graph does not exist');
    });

    test.each(['organization-viewer', 'graph-viewer', 'subgraph-viewer'])(
      '%s should NOT be able to create ignore overrides',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
        onTestFinished(() => server.close());

        const { fedGraphName, checkId } = await setupCheckWithBreakingChanges(client, chClient);

        const getGraphResponse = await client.getFederatedGraphByName({
          name: fedGraphName,
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

        const response = await client.createIgnoreOverridesForAllOperations({
          graphName: fedGraphName,
          namespace: DEFAULT_NAMESPACE,
          checkId,
        });

        expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      },
    );
  });

  describe('removeOperationIgnoreAllOverride', () => {
    test('Should remove an ignore override', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const { fedGraphName, checkId } = await setupCheckWithBreakingChanges(client, chClient);

      // First create the ignore override
      await client.createIgnoreOverridesForAllOperations({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        checkId,
      });

      // Then remove it
      const response = await client.removeOperationIgnoreAllOverride({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        operationHash: 'hash1',
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      // Verify the ignore override is removed
      const overridesResp = await client.getOperationOverrides({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        operationHash: 'hash1',
      });
      expect(overridesResp.ignoreAll).toBe(false);
    });

    test('Should fail when the graph does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const response = await client.removeOperationIgnoreAllOverride({
        graphName: 'nonexistent',
        namespace: DEFAULT_NAMESPACE,
        operationHash: 'any-hash',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });

    test('Should fail when trying to remove a non-existent override', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const { fedGraphName } = await setupCheckWithBreakingChanges(client, chClient);

      const response = await client.removeOperationIgnoreAllOverride({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        operationHash: 'nonexistent-hash',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR);
      expect(response.response?.details).toContain('Could not remove ignore override');
    });
  });

  describe('toggleChangeOverridesForAllOperations', () => {
    test('Should mark all affected operations as safe (isSafe=true)', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const { fedGraphName, checkId } = await setupCheckWithBreakingChanges(client, chClient);

      const response = await client.toggleChangeOverridesForAllOperations({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        checkId,
        isSafe: true,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      // Verify the overrides were created
      const overridesResp = await client.getOperationOverrides({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        operationHash: 'hash1',
      });
      expect(overridesResp.response?.code).toBe(EnumStatusCode.OK);
      expect(overridesResp.changes.length).toBe(1);
    });

    test('Should remove safe markers (isSafe=false) after marking them safe', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const { fedGraphName, checkId } = await setupCheckWithBreakingChanges(client, chClient);

      // First mark as safe
      await client.toggleChangeOverridesForAllOperations({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        checkId,
        isSafe: true,
      });

      // Then remove safe markers
      const response = await client.toggleChangeOverridesForAllOperations({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        checkId,
        isSafe: false,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);

      // Verify the overrides were removed
      const overridesResp = await client.getOperationOverrides({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        operationHash: 'hash1',
      });
      expect(overridesResp.response?.code).toBe(EnumStatusCode.OK);
      expect(overridesResp.changes).toEqual([]);
    });

    test('Should fail when graph does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const response = await client.toggleChangeOverridesForAllOperations({
        graphName: 'nonexistent',
        namespace: DEFAULT_NAMESPACE,
        checkId: '00000000-0000-0000-0000-000000000000',
        isSafe: true,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });
  });

  describe('getOperationOverrides', () => {
    test('Should return empty overrides for an operation with no overrides', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const { fedGraphName } = await setupCheckWithBreakingChanges(client, chClient);

      const response = await client.getOperationOverrides({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        operationHash: 'hash1',
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.changes).toEqual([]);
      expect(response.ignoreAll).toBe(false);
    });

    test('Should fail when the graph does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const response = await client.getOperationOverrides({
        graphName: 'nonexistent',
        namespace: DEFAULT_NAMESPACE,
        operationHash: 'some-hash',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(response.changes).toEqual([]);
      expect(response.ignoreAll).toBe(false);
    });

    test.each(['organization-admin', 'organization-developer', 'organization-viewer', 'graph-admin', 'graph-viewer'])(
      '%s should be able to get operation overrides',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
        onTestFinished(() => server.close());

        const { fedGraphName } = await setupCheckWithBreakingChanges(client, chClient);

        const getGraphResponse = await client.getFederatedGraphByName({
          name: fedGraphName,
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

        const response = await client.getOperationOverrides({
          graphName: fedGraphName,
          namespace: DEFAULT_NAMESPACE,
          operationHash: 'hash1',
        });

        expect(response.response?.code).toBe(EnumStatusCode.OK);
      },
    );

    test.each([
      'namespace-admin',
      'namespace-viewer',
      'subgraph-admin',
      'subgraph-publisher',
      'subgraph-viewer',
      'organization-apikey-manager',
    ])('%s should NOT be able to get operation overrides', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      onTestFinished(() => server.close());

      const { fedGraphName } = await setupCheckWithBreakingChanges(client, chClient);

      const getGraphResponse = await client.getFederatedGraphByName({
        name: fedGraphName,
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

      const response = await client.getOperationOverrides({
        graphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        operationHash: 'hash1',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    });
  });
});
