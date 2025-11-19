import { describe, expect, test, vi, beforeEach, afterEach, beforeAll, afterAll, Mock } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { formatISO, subHours } from 'date-fns';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, SetupTest, createFederatedGraph, createThenPublishSubgraph } from '../test-util.js';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('GetOperationClients', () => {
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

    const response = await client.getOperationClients({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
    expect(response.clients).toEqual([]);

    await server.close();
  });

  test('Should return ERR_NOT_FOUND when federated graph does not exist', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
    const fedGraphName = genID('nonExistentGraph');

    const response = await client.getOperationClients({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain(`Federated graph '${fedGraphName}' not found`);
    expect(response.clients).toEqual([]);

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
    const response = await client.getOperationClients({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      dateRange: {
        start: '2024-01-02T00:00:00Z',
        end: '2024-01-01T00:00:00Z',
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Invalid date range');
    expect(response.clients).toEqual([]);

    await server.close();
  });

  test('Should return empty clients when no clients exist', async () => {
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

    const response = await client.getOperationClients({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.clients).toEqual([]);

    await server.close();
  });

  test('Should return clients for an operation', async () => {
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

    const mockClients = [
      {
        name: 'test-client',
        version: '1.0.0',
        requestCount: 100,
        lastUsed: '2024-01-01 12:00:00',
      },
      {
        name: 'test-client',
        version: '2.0.0',
        requestCount: 50,
        lastUsed: '2024-01-01 11:00:00',
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockClients);

    const response = await client.getOperationClients({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.clients).toHaveLength(2);
    expect(response.clients[0]?.name).toBe('test-client');
    expect(response.clients[0]?.version).toBe('1.0.0');
    expect(response.clients[0]?.requestCount).toBe(BigInt(100));
    expect(response.clients[1]?.name).toBe('test-client');
    expect(response.clients[1]?.version).toBe('2.0.0');
    expect(response.clients[1]?.requestCount).toBe(BigInt(50));

    await server.close();
  });

  test('Should handle clients with empty name and version', async () => {
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

    const mockClients = [
      {
        name: null,
        version: null,
        requestCount: 100,
        lastUsed: '2024-01-01 12:00:00',
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockClients);

    const response = await client.getOperationClients({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.clients).toHaveLength(1);
    expect(response.clients[0]?.name).toBe('');
    expect(response.clients[0]?.version).toBe('');
    expect(response.clients[0]?.requestCount).toBe(BigInt(100));

    await server.close();
  });

  test('Should handle clients with zero request count', async () => {
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

    const mockClients = [
      {
        name: 'test-client',
        version: '1.0.0',
        requestCount: 0,
        lastUsed: '2024-01-01 12:00:00',
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockClients);

    const response = await client.getOperationClients({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.clients).toHaveLength(1);
    expect(response.clients[0]?.requestCount).toBe(BigInt(0));

    await server.close();
  });

  test('Should handle date range correctly', async () => {
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

    const mockClients = [
      {
        name: 'test-client',
        version: '1.0.0',
        requestCount: 100,
        lastUsed: '2024-01-01 12:00:00',
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockClients);

    const response = await client.getOperationClients({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      dateRange: {
        start: formatISO(subHours(new Date(), 24)),
        end: formatISO(new Date()),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.clients).toHaveLength(1);

    await server.close();
  });

  test('Should handle range parameter correctly', async () => {
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

    const mockClients = [
      {
        name: 'test-client',
        version: '1.0.0',
        requestCount: 100,
        lastUsed: '2024-01-01 12:00:00',
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockClients);

    const response = await client.getOperationClients({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      range: 24, // 24 hours
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.clients).toHaveLength(1);

    await server.close();
  });

  test('Should handle operation hash with special characters', async () => {
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

    const mockClients = [
      {
        name: 'test-client',
        version: '1.0.0',
        requestCount: 100,
        lastUsed: '2024-01-01 12:00:00',
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockClients);

    const response = await client.getOperationClients({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: "test'hash", // Contains single quote
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.clients).toHaveLength(1);

    await server.close();
  });

  test('Should handle operation name with special characters', async () => {
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

    const mockClients = [
      {
        name: 'test-client',
        version: '1.0.0',
        requestCount: 100,
        lastUsed: '2024-01-01 12:00:00',
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockClients);

    const response = await client.getOperationClients({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      operationName: "test'operation", // Contains single quote
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.clients).toHaveLength(1);

    await server.close();
  });

  test('Should handle multiple clients with same name but different versions', async () => {
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

    const mockClients = [
      {
        name: 'test-client',
        version: '1.0.0',
        requestCount: 100,
        lastUsed: '2024-01-01 12:00:00',
      },
      {
        name: 'test-client',
        version: '2.0.0',
        requestCount: 200,
        lastUsed: '2024-01-01 13:00:00',
      },
      {
        name: 'another-client',
        version: '1.0.0',
        requestCount: 50,
        lastUsed: '2024-01-01 11:00:00',
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockClients);

    const response = await client.getOperationClients({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.clients.length).toBeGreaterThanOrEqual(2);
    // Should group by ClientName and ClientVersion
    const testClientVersions = response.clients.filter((c) => c.name === 'test-client').map((c) => c.version);
    expect(testClientVersions).toContain('1.0.0');
    expect(testClientVersions).toContain('2.0.0');

    await server.close();
  });
});
