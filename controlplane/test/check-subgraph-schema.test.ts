import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { addSeconds, formatISO, subDays } from 'date-fns';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, Mock, test, vi } from 'vitest';
import {
  invalidOverrideTargetSubgraphNameWarning,
  noBaseDefinitionForExtensionError,
  OBJECT,
} from '@wundergraph/composition';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { SchemaChangeType } from '../src/types/index.js';
import { DEFAULT_NAMESPACE, SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('CheckSubgraphSchema', (ctx) => {
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

  test('Should be able to create a subgraph, publish the schema and then check with new schema', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    let resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: 'type Query { hello: String! }',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    // test for no changes in schema
    let checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.breakingChanges.length).toBe(0);
    expect(checkResp.nonBreakingChanges.length).toBe(0);

    // test for breaking changes in schema
    checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { name: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.breakingChanges.length).not.toBe(0);
    expect(checkResp.breakingChanges[0].changeType).toBe(SchemaChangeType.FIELD_REMOVED);
    expect(checkResp.nonBreakingChanges.length).not.toBe(0);
    expect(checkResp.nonBreakingChanges[0].changeType).toBe(SchemaChangeType.FIELD_ADDED);

    await server.close();
  });

  test('Should be able to create a federated graph,subgraph, publish the schema and then check the new schema for composition errors', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String! }',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! } extend type Product { hello: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors).toHaveLength(1);
    expect(checkResp.compositionErrors[0].message).toBe(noBaseDefinitionForExtensionError(OBJECT, 'Product').message);

    await server.close();
  });

  test('Should be able to create a federated graph,subgraph, publish the schema and then check the new schema for composition warning', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String! }',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! @override(from: "employees") }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionWarnings).toHaveLength(1);
    expect(checkResp.compositionWarnings[0].message).toBe(
      invalidOverrideTargetSubgraphNameWarning('employees', 'Query', ['hello'], subgraphName).message,
    );

    await server.close();
  });

  test('Should be able to create a federated graph,subgraph and then perform the check operation on the subgragh with valid schema ', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors).toHaveLength(0);
    expect(checkResp.breakingChanges).toHaveLength(0);

    await server.close();
  });

  test('Should retrieve checks performed against unpublished subgraphs', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

    const checksResp = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: 'default',
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addSeconds(new Date(), 5)),
      limit: 10,
      offset: 0,
    });
    expect(checksResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checksResp.checks?.length).toBe(1);

    await server.close();
  });

  test('Should retrieve checked operations', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const fedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();

    const initSchema = `
type Query {
  employees: [Employee!]!
}

type Employee {
  id: Int!
}
`;

    const modifiedSchema = `
type Query {
  employees: [Employee]
}

type Employee {
  id: Int!
}
`;

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const createSubgraphRes = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });
    expect(createSubgraphRes.response?.code).toBe(EnumStatusCode.OK);

    const publishResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: initSchema,
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    (chClient.queryPromise as Mock).mockResolvedValue([
      {
        operationHash: 'hash1',
        operationName: 'op1',
        operationType: 'query',
        firstSeen: Date.now() / 1000,
        lastSeen: Date.now() / 1000,
      },
      {
        operationHash: 'hash2',
        operationName: 'op2',
        operationType: 'query',
        firstSeen: Date.now() / 1000,
        lastSeen: Date.now() / 1000,
      },
    ]);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Buffer.from(modifiedSchema),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.breakingChanges.length).toBe(1);
    expect(checkResp.operationUsageStats?.totalOperations).toBe(2);
    expect(checkResp.operationUsageStats?.safeOperations).toBe(0);

    const checkOperationsResp = await client.getCheckOperations({
      checkId: checkResp.checkId,
      graphName: fedGraphName,
      namespace: 'default',
    });
    expect(checkOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkOperationsResp.operations.length).toBe(2);

    await server.close();
  });

  test('Should have zero checked operations if traffic is skipped', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const fedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();

    const initSchema = `
type Query {
  employees: [Employee!]!
}

type Employee {
  id: Int!
}
`;

    const modifiedSchema = `
type Query {
  employees: [Employee]
}

type Employee {
  id: Int!
}
`;

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const createSubgraphRes = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });
    expect(createSubgraphRes.response?.code).toBe(EnumStatusCode.OK);

    const publishResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: initSchema,
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    (chClient.queryPromise as Mock).mockResolvedValue([
      {
        operationHash: 'hash1',
        operationName: 'op1',
        operationType: 'query',
        firstSeen: Date.now() / 1000,
        lastSeen: Date.now() / 1000,
      },
      {
        operationHash: 'hash2',
        operationName: 'op2',
        operationType: 'query',
        firstSeen: Date.now() / 1000,
        lastSeen: Date.now() / 1000,
      },
    ]);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Buffer.from(modifiedSchema),
      skipTrafficCheck: true,
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.breakingChanges.length).toBe(1);
    expect(checkResp.operationUsageStats?.totalOperations).toBe(0);
    expect(checkResp.operationUsageStats?.safeOperations).toBe(0);
    expect(checkResp.clientTrafficCheckSkipped).toBe(true);

    const checkOperationsResp = await client.getCheckOperations({
      checkId: checkResp.checkId,
      graphName: fedGraphName,
      namespace: 'default',
    });
    expect(checkOperationsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkOperationsResp.operations.length).toBe(0);

    await server.close();
  });
});
