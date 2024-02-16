import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi, Mock } from 'vitest';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

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

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Overrides', (ctx) => {
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

  test('Should be able to detect overrides', async (testContext) => {
    const { client, server } = await SetupTest({ testContext, dbname, chClient });

    const fedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();

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
      schema: Buffer.from(initSchema),
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

    const graphRes = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });
    const namespacesRes = await client.getNamespaces({});
    const namespace = namespacesRes.namespaces.find((n) => n.name === graphRes.graph?.namespace);
    expect(namespace).toBeDefined();
    expect(graphRes.response?.code).toBe(EnumStatusCode.OK);

    const createOverrideRes = await client.createOperationOverrides({
      graphName: graphRes.graph?.name,
      namespace: graphRes.graph?.namespace,
      operationHash: 'hash1',
      operationName: 'op1',
      changes: checkResp.breakingChanges,
    });
    expect(createOverrideRes.response?.code).toBe(EnumStatusCode.OK);

    const checkResp2 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Buffer.from(modifiedSchema),
    });
    expect(checkResp2.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp2.breakingChanges.length).toBe(1);
    expect(checkResp2.operationUsageStats?.totalOperations).toBe(2);
    expect(checkResp2.operationUsageStats?.safeOperations).toBe(1);

    const createIgnoreOverrideRes = await client.createOperationIgnoreAllOverride({
      graphName: graphRes.graph?.name,
      namespace: graphRes.graph?.namespace,
      operationHash: 'hash2',
      operationName: 'op2',
    });
    expect(createIgnoreOverrideRes.response?.code).toBe(EnumStatusCode.OK);

    const checkResp3 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Buffer.from(modifiedSchema),
    });
    expect(checkResp3.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp3.breakingChanges.length).toBe(1);
    expect(checkResp3.operationUsageStats?.totalOperations).toBe(2);
    expect(checkResp3.operationUsageStats?.safeOperations).toBe(2);

    const removeOverrideRes = await client.removeOperationOverrides({
      graphName: graphRes.graph?.name,
      namespace: graphRes.graph?.namespace,
      operationHash: 'hash1',
      changes: checkResp.breakingChanges,
    });
    expect(removeOverrideRes.response?.code).toBe(EnumStatusCode.OK);

    const checkResp4 = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Buffer.from(modifiedSchema),
    });
    expect(checkResp4.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp4.breakingChanges.length).toBe(1);
    expect(checkResp4.operationUsageStats?.totalOperations).toBe(2);
    expect(checkResp4.operationUsageStats?.safeOperations).toBe(1);

    await server.close();
  });

  test('Should get correct consolidated view', async (testContext) => {
    const { client, server } = await SetupTest({ testContext, dbname });

    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graphRes = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });

    const namespacesRes = await client.getNamespaces({});
    const namespace = namespacesRes.namespaces.find((n) => n.name === graphRes.graph?.namespace);

    expect(namespace).toBeDefined();
    expect(graphRes.response?.code).toBe(EnumStatusCode.OK);

    const createOverrideRes = await client.createOperationOverrides({
      graphName: graphRes.graph?.name,
      namespace: graphRes.graph?.namespace,
      operationHash: 'hash1',
      operationName: 'op1',
      changes: [
        {
          changeType: 'FIELD_TYPE_CHANGED',
          path: 'A.field',
        },
      ],
    });
    expect(createOverrideRes.response?.code).toBe(EnumStatusCode.OK);

    const createIgnoreOverrideRes = await client.createOperationIgnoreAllOverride({
      graphName: graphRes.graph?.name,
      namespace: graphRes.graph?.namespace,
      operationHash: 'hash2',
      operationName: 'op2',
    });
    expect(createIgnoreOverrideRes.response?.code).toBe(EnumStatusCode.OK);

    const overridesRes = await client.getAllOverrides({
      graphName: graphRes.graph?.name,
      namespace: graphRes?.graph?.namespace,
    });
    expect(overridesRes.response?.code).toBe(EnumStatusCode.OK);
    expect(overridesRes.overrides.length).toBe(2);

    expect(overridesRes.overrides[0].hash).toBe('hash1');
    expect(overridesRes.overrides[0].changesOverrideCount).toBe(1);
    expect(overridesRes.overrides[0].hasIgnoreAllOverride).toBe(false);

    expect(overridesRes.overrides[1].hash).toBe('hash2');
    expect(overridesRes.overrides[1].changesOverrideCount).toBe(0);
    expect(overridesRes.overrides[1].hasIgnoreAllOverride).toBe(true);

    await server.close();
  });
});
