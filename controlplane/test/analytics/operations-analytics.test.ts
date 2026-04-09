import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, onTestFinished, test, type Mock, vi } from 'vitest';
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

describe('Operations Analytics', () => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
    (chClient.queryPromise as Mock).mockResolvedValue([]);
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

  describe('getOperationContent', () => {
    test('Should return ERR_ANALYTICS_DISABLED when chClient is not configured', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getOperationContent({
        hash: 'some-hash',
        federatedGraphName: 'some-graph',
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
    });

    test('Should fail when federated graph does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const response = await client.getOperationContent({
        hash: 'some-hash',
        federatedGraphName: 'nonexistent',
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });

    test('Should return empty content when operation is not found', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      // Mock returns empty array so no operation is found
      const response = await client.getOperationContent({
        hash: 'nonexistent-hash',
        federatedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect([EnumStatusCode.OK, EnumStatusCode.ERR_NOT_FOUND]).toContain(response.response?.code);
    });
  });

  describe('getOperations', () => {
    test('Should return ERR_ANALYTICS_DISABLED when chClient is not configured', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getOperations({
        federatedGraphName: 'some-graph',
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
      expect(response.operations).toEqual([]);
    });

    test('Should fail when federated graph does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const response = await client.getOperations({
        federatedGraphName: 'nonexistent',
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(response.operations).toEqual([]);
    });

    test('Should return empty operations list for a new graph', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const response = await client.getOperations({
        federatedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.operations).toEqual([]);
    });
  });

  describe('getOperationClients', () => {
    test('Should return ERR_ANALYTICS_DISABLED when chClient is not configured', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getOperationClients({
        operationHash: 'some-hash',
        federatedGraphName: 'some-graph',
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
      expect(response.clients).toEqual([]);
    });

    test('Should fail when federated graph does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const response = await client.getOperationClients({
        operationHash: 'some-hash',
        federatedGraphName: 'nonexistent',
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });
  });

  describe('getOperationDeprecatedFields', () => {
    test('Should return ERR_ANALYTICS_DISABLED when chClient is not configured', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getOperationDeprecatedFields({
        operationHash: 'some-hash',
        federatedGraphName: 'some-graph',
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
    });

    test('Should fail when federated graph does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const response = await client.getOperationDeprecatedFields({
        operationHash: 'some-hash',
        federatedGraphName: 'nonexistent',
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });
  });

  describe('getOrganizationRequestsCount', () => {
    test('Should return the monthly request count', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      (chClient.queryPromise as Mock).mockResolvedValue([{ count: 42 }]);

      const response = await client.getOrganizationRequestsCount({});

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(typeof response.count).toBe('bigint');
    });

    test('Should return ERR_ANALYTICS_DISABLED when chClient is not configured', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getOrganizationRequestsCount({});

      expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
      expect(response.count).toBe(BigInt(0));
    });

    test('organization-admin should be able to call the RPC', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      (chClient.queryPromise as Mock).mockResolvedValue([{ count: 10 }]);

      const response = await client.getOrganizationRequestsCount({});

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    });

    test.each([
      'organization-developer',
      'organization-viewer',
      'organization-apikey-manager',
      'namespace-admin',
      'namespace-viewer',
      'graph-admin',
      'graph-viewer',
      'subgraph-admin',
      'subgraph-publisher',
      'subgraph-viewer',
    ])('%s (non-admin) should NOT be able to call the RPC', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.getOrganizationRequestsCount({});

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    });
  });

  describe('getTrace', () => {
    test('Should return ERR_ANALYTICS_DISABLED when chClient is not configured', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getTrace({
        id: 'trace-id',
        spanId: 'span-id',
        federatedGraphId: 'graph-id',
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
      expect(response.spans).toEqual([]);
    });

    test('Should return empty spans when trace is not found', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const response = await client.getTrace({
        id: 'nonexistent-trace',
        spanId: '',
        federatedGraphId: '00000000-0000-0000-0000-000000000000',
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.spans).toEqual([]);
    });
  });

  describe('getClientsFromAnalytics', () => {
    test('Should return ERR_ANALYTICS_DISABLED when chClient is not configured', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getClientsFromAnalytics({
        federatedGraphName: 'some-graph',
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
      expect(response.clients).toEqual([]);
    });

    test('Should fail when federated graph does not exist', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const response = await client.getClientsFromAnalytics({
        federatedGraphName: 'nonexistent',
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(response.clients).toEqual([]);
    });

    test('Should return clients for a valid graph', async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      testContext.onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const response = await client.getClientsFromAnalytics({
        federatedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.clients).toEqual([]);
    });
  });
});
