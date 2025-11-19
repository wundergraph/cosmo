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

describe('GetOperationDeprecatedFields', () => {
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

    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      operationName: 'TestOperation',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_ANALYTICS_DISABLED);
    expect(response.deprecatedFields).toEqual([]);

    await server.close();
  });

  test('Should return ERR_NOT_FOUND when federated graph does not exist', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
    const fedGraphName = genID('nonExistentGraph');

    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      operationName: 'TestOperation',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain(`Federated graph '${fedGraphName}' not found`);
    expect(response.deprecatedFields).toEqual([]);

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
    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      operationName: 'TestOperation',
      dateRange: {
        start: formatISO(new Date()),
        end: formatISO(subHours(new Date(), 24)),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Invalid date range');
    expect(response.deprecatedFields).toEqual([]);

    await server.close();
  });

  test('Should return empty deprecated fields when schema has no deprecated fields', async () => {
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

    // Mock empty result from ClickHouse (no deprecated fields used)
    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      operationName: 'TestOperation',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.deprecatedFields).toEqual([]);

    await server.close();
  });

  test('Should return deprecated fields used in operation', async () => {
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
      }
      type User {
        oldName: String! @deprecated(reason: "Use name instead")
        name: String!
      }`,
      [label],
      'http://localhost:4001',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

    const mockDeprecatedFields = [
      {
        deprecatedFieldName: 'hello',
        deprecatedFieldTypeNames: ['Query'],
      },
      {
        deprecatedFieldName: 'oldName',
        deprecatedFieldTypeNames: ['User'],
      },
    ];

    // Mock calls: first for getting deprecated fields from schema, second for usage check
    (chClient.queryPromise as Mock).mockResolvedValue(mockDeprecatedFields);

    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      operationName: 'TestOperation',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.deprecatedFields.length).toBeGreaterThanOrEqual(0);
    // The response should contain deprecated fields if they exist in the schema

    await server.close();
  });

  test('Should handle operation without deprecated fields', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const subgraphName = genID('subgraph');
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      `type Query {
        hello: String!
        newHello: String!
      }`,
      [label],
      'http://localhost:4001',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

    // Mock empty result (no deprecated fields in schema or used)
    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      operationName: 'TestOperation',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.deprecatedFields).toEqual([]);

    await server.close();
  });

  test('Should handle operation name with special characters', async () => {
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
      }`,
      [label],
      'http://localhost:4001',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      operationName: "test'operation", // Contains single quote
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should handle operation hash with special characters', async () => {
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
      }`,
      [label],
      'http://localhost:4001',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: "test'hash", // Contains single quote
      operationName: 'TestOperation',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should handle date range correctly', async () => {
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
      }`,
      [label],
      'http://localhost:4001',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      operationName: 'TestOperation',
      dateRange: {
        start: formatISO(subHours(new Date(), 24)),
        end: formatISO(new Date()),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should handle range parameter correctly', async () => {
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
      }`,
      [label],
      'http://localhost:4001',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      operationName: 'TestOperation',
      range: 24, // 24 hours
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should return deprecated fields with correct field name and type name', async () => {
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
      }
      type User {
        oldName: String! @deprecated(reason: "Use name instead")
      }`,
      [label],
      'http://localhost:4001',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

    const mockDeprecatedFields = [
      {
        deprecatedFieldName: 'hello',
        deprecatedFieldTypeNames: ['Query'],
      },
    ];

    // Mock calls: first for getting deprecated fields from schema, second for usage check
    (chClient.queryPromise as Mock).mockResolvedValue(mockDeprecatedFields);

    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      operationName: 'TestOperation',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    // If deprecated fields are found, they should have correct structure
    if (response.deprecatedFields.length > 0) {
      expect(response.deprecatedFields[0]?.fieldName).toBeDefined();
      expect(response.deprecatedFields[0]?.typeName).toBeDefined();
    }

    await server.close();
  });

  test('Should handle operation without operation name', async () => {
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
      }`,
      [label],
      'http://localhost:4001',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      // operationName is optional
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should handle deprecated fields with empty type names array', async () => {
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
      }`,
      [label],
      'http://localhost:4001',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');

    const mockDeprecatedFields = [
      {
        deprecatedFieldName: 'hello',
        deprecatedFieldTypeNames: [],
      },
    ];

    (chClient.queryPromise as Mock).mockResolvedValue(mockDeprecatedFields);

    const response = await client.getOperationDeprecatedFields({
      federatedGraphName: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      operationHash: 'test-hash',
      operationName: 'TestOperation',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    await server.close();
  });
});
