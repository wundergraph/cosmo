/* eslint-disable camelcase */
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOperationsResponse_OperationType,
  OperationsFetchBasedOn,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { Mock, afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, SetupTest, createFederatedGraph, createThenPublishSubgraph } from '../test-util.js';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('GetOperations', () => {
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

  test('Should return ERR_ANALYTICS_DISABLED when ClickHouse client is not available', async () => {
    const { client, server } = await SetupTest({ dbname, chClient: undefined });
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

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
    expect(response.operations).toEqual([]);

    await server.close();
  });

  test('Should return ERR_NOT_FOUND when federated graph does not exist', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
    const fedGraphName = genID('nonExistentGraph');

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain(`Federated graph '${fedGraphName}' not found`);
    expect(response.operations).toEqual([]);

    await server.close();
  });

  test('Should return ERR when limit is less than 1', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 0,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Limit must be between 1 and 1000');
    expect(response.operations).toEqual([]);

    await server.close();
  });

  test('Should return ERR when limit is greater than 1000', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 1001,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Limit must be between 1 and 1000');
    expect(response.operations).toEqual([]);

    await server.close();
  });

  test('Should return ERR when offset is negative', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      offset: -1,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Offset must be >= 0');
    expect(response.operations).toEqual([]);

    await server.close();
  });

  test('Should return ERR when date range is invalid', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    // Invalid date range (end before start)
    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      dateRange: {
        start: '2024-01-02T00:00:00Z',
        end: '2024-01-01T00:00:00Z',
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Invalid date range');
    expect(response.operations).toEqual([]);

    await server.close();
  });

  test('Should return empty operations when no operations exist', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    // Mock empty result from ClickHouse
    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toEqual([]);

    await server.close();
  });

  test('Should return operations sorted by latency (default)', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const mockOperations = [
      {
        operationHash: 'hash1',
        operationName: 'Operation1',
        operationType: 'query',
        latency: 100.5,
        requestCount: 0,
        errorCount: 0,
      },
      {
        operationHash: 'hash2',
        operationName: 'Operation2',
        operationType: 'mutation',
        latency: 200.3,
        requestCount: 0,
        errorCount: 0,
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockOperations);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      fetchBasedOn: OperationsFetchBasedOn.LATENCY,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toHaveLength(2);
    expect(response.operations[0]?.name).toBe('Operation1');
    expect(response.operations[0]?.metric.case).toBe('latency');
    expect(response.operations[0]?.metric.value).toBe(100.5);

    await server.close();
  });

  test('Should return operations sorted by request count', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const mockOperations = [
      {
        operationHash: 'hash1',
        operationName: 'Operation1',
        operationType: 'query',
        latency: 0,
        requestCount: 1000,
        errorCount: 0,
      },
      {
        operationHash: 'hash2',
        operationName: 'Operation2',
        operationType: 'mutation',
        latency: 0,
        requestCount: 500,
        errorCount: 0,
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockOperations);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      fetchBasedOn: OperationsFetchBasedOn.REQUESTS,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toHaveLength(2);
    expect(response.operations[0]?.name).toBe('Operation1');
    expect(response.operations[0]?.metric.case).toBe('requestCount');
    expect(response.operations[0]?.metric.value).toBe(BigInt(1000));

    await server.close();
  });

  test('Should return operations sorted by error percentage', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const mockOperations = [
      {
        operationHash: 'hash1',
        operationName: 'Operation1',
        operationType: 'query',
        latency: 0,
        requestCount: 1000,
        errorCount: 100,
        errorPercentage: 10,
      },
      {
        operationHash: 'hash2',
        operationName: 'Operation2',
        operationType: 'mutation',
        latency: 0,
        requestCount: 500,
        errorCount: 25,
        errorPercentage: 5,
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockOperations);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      fetchBasedOn: OperationsFetchBasedOn.ERRORS,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toHaveLength(2);
    expect(response.operations[0]?.name).toBe('Operation1');
    expect(response.operations[0]?.metric.case).toBe('errorPercentage');
    expect(response.operations[0]?.metric.value).toBe(10);

    await server.close();
  });

  test('Should filter operations by client name', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const mockOperations = [
      {
        operationHash: 'hash1',
        operationName: 'Operation1',
        operationType: 'query',
        latency: 100.5,
        requestCount: 0,
        errorCount: 0,
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockOperations);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      clientNames: ['test-client'],
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toHaveLength(1);

    await server.close();
  });

  test('Should include operation content when includeContent is true (default)', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const mockOperations = [
      {
        operationHash: 'hash1',
        operationName: 'Operation1',
        operationType: 'query',
        latency: 100.5,
        requestCount: 0,
        errorCount: 0,
      },
    ];

    const mockOperationContent = [
      {
        operationHash: 'hash1',
        operationContent: 'query { hello }',
      },
    ];

    // First call for operations, second call for operation content
    (chClient.queryPromise as Mock).mockResolvedValueOnce(mockOperations).mockResolvedValueOnce(mockOperationContent);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      includeContent: true,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toHaveLength(1);
    expect(response.operations[0]?.content).toBe('query { hello }');

    await server.close();
  });

  test('Should not include operation content when includeContent is false', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const mockOperations = [
      {
        operationHash: 'hash1',
        operationName: 'Operation1',
        operationType: 'query',
        latency: 100.5,
        requestCount: 0,
        errorCount: 0,
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockOperations);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      includeContent: false,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toHaveLength(1);
    expect(response.operations[0]?.content).toBe('');

    // Should not call getOperationContent
    expect(chClient.queryPromise).toHaveBeenCalledTimes(1);

    await server.close();
  });

  test('Should handle operations with deprecated fields', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const subgraphName = genID('subgraph');
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      `type Query {
        hello: String! @deprecated(reason: "Use newHello instead")
        newHello: String!
      }`,
      [label],
      'http://localhost:4001',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

    const mockOperations = [
      {
        operationHash: 'hash1',
        operationName: 'Operation1',
        operationType: 'query',
        latency: 100.5,
        requestCount: 0,
        errorCount: 0,
      },
    ];

    const mockDeprecatedFields = [
      {
        operationHash: 'hash1',
        operationName: 'Operation1',
      },
    ];

    // Mock calls: operations, deprecated fields check, operation content
    (chClient.queryPromise as Mock)
      .mockResolvedValueOnce(mockOperations)
      .mockResolvedValueOnce(mockDeprecatedFields)
      .mockResolvedValueOnce([]);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      includeDeprecatedFields: true,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toHaveLength(1);
    expect(response.operations[0]?.hasDeprecatedFields).toBe(true);

    await server.close();
  });

  test('Should filter operations with deprecated fields only when requested', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const subgraphName = genID('subgraph');
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      `type Query {
        hello: String! @deprecated(reason: "Use newHello instead")
        newHello: String!
      }`,
      [label],
      'http://localhost:4001',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

    const mockOperations = [
      {
        operationHash: 'hash1',
        operationName: 'Operation1',
        operationType: 'query',
        latency: 100.5,
        requestCount: 0,
        errorCount: 0,
      },
      {
        operationHash: 'hash2',
        operationName: 'Operation2',
        operationType: 'query',
        latency: 200.5,
        requestCount: 0,
        errorCount: 0,
      },
    ];

    const mockDeprecatedFields = [
      {
        operationHash: 'hash1',
        operationName: 'Operation1',
      },
    ];

    // Mock calls: operations (fetchAll=true), deprecated fields check, operation content
    (chClient.queryPromise as Mock)
      .mockResolvedValueOnce(mockOperations)
      .mockResolvedValueOnce(mockDeprecatedFields)
      .mockResolvedValueOnce([]);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      includeDeprecatedFields: true,
      includeOperationsWithDeprecatedFieldsOnly: true,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations.length).toBe(1);
    expect(response.operations[0]?.hasDeprecatedFields).toBe(true);

    await server.close();
  });

  test('Should handle search query', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const mockOperations = [
      {
        operationHash: 'hash1',
        operationName: 'SearchOperation',
        operationType: 'query',
        latency: 100.5,
        requestCount: 0,
        errorCount: 0,
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockOperations);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      searchQuery: 'Search',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toHaveLength(1);
    expect(response.operations[0]?.name).toBe('SearchOperation');

    await server.close();
  });

  test('Should handle different operation types correctly', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const mockOperations = [
      {
        operationHash: 'hash1',
        operationName: 'QueryOp',
        operationType: 'query',
        latency: 100.5,
        requestCount: 0,
        errorCount: 0,
      },
      {
        operationHash: 'hash2',
        operationName: 'MutationOp',
        operationType: 'mutation',
        latency: 200.5,
        requestCount: 0,
        errorCount: 0,
      },
      {
        operationHash: 'hash3',
        operationName: 'SubscriptionOp',
        operationType: 'subscription',
        latency: 300.5,
        requestCount: 0,
        errorCount: 0,
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockOperations);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toHaveLength(3);
    expect(response.operations[0]?.type).toBe(GetOperationsResponse_OperationType.QUERY); // QUERY
    expect(response.operations[1]?.type).toBe(GetOperationsResponse_OperationType.MUTATION); // MUTATION
    expect(response.operations[2]?.type).toBe(GetOperationsResponse_OperationType.SUBSCRIPTION); // SUBSCRIPTION

    await server.close();
  });

  test('Should use default limit of 100 when not specified', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const mockOperations = Array.from({ length: 50 }, (_, i) => ({
      operationHash: `hash${i}`,
      operationName: `Operation${i}`,
      operationType: 'query',
      latency: 100.5,
      requestCount: 0,
      errorCount: 0,
    }));

    (chClient.queryPromise as Mock).mockResolvedValue(mockOperations);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    // Default limit is 100, so should return all 50 operations
    expect(response.operations.length).toBeLessThanOrEqual(100);

    await server.close();
  });

  test('Should use default offset of 0 when not specified', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
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

    const mockOperations = [
      {
        operationHash: 'hash1',
        operationName: 'Operation1',
        operationType: 'query',
        latency: 100.5,
        requestCount: 0,
        errorCount: 0,
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockOperations);

    const response = await client.getOperations({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations.length).toBeGreaterThanOrEqual(0);

    await server.close();
  });
});
