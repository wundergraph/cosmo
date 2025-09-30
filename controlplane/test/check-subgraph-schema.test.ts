import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { addSeconds, formatISO, subDays } from 'date-fns';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, Mock, test, vi } from 'vitest';
import {
  invalidOverrideTargetSubgraphNameWarning,
  noBaseDefinitionForExtensionError,
  OBJECT,
} from '@wundergraph/composition';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
} from '../src/core/test-util.js';
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

  test.each(['organization-admin', 'organization-developer', 'subgraph-admin', 'subgraph-publisher', 'subgraph-checker'])(
    '%s should be able to create a subgraph, publish the schema and then check with new schema',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });

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

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

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
    },
  );

  test('Should allow legacy fallback when checking graph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });

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

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(),
    });

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

  test.each(['subgraph-admin', 'subgraph-publisher', 'subgraph-checker'])(
    '%s should be able to check with new schema on allowed namespaces',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });

      const subgraphName = genID('subgraph1');
      const label = genUniqueLabel();

      const getNamespaceResponse = await client.getNamespace({ name: DEFAULT_NAMESPACE });
      expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

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

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            namespaces: [getNamespaceResponse.namespace!.id],
          }),
        ),
      });

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

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            namespaces: [randomUUID()],
          }),
        ),
      });

      // test for breaking changes in schema
      checkResp = await client.checkSubgraphSchema({
        subgraphName,
        namespace: 'default',
        schema: Uint8Array.from(Buffer.from('type Query { name: String! }')),
      });
      expect(checkResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      await server.close();
    },
  );

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-viewer',
  ])('%s should not be able to create a subgraph, publish the schema and then check with new schema', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });

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

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    // test for no changes in schema
    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

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

    const checkSummary = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: federatedGraphName,
      checkId: checkResp.checkId,
    });

    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);
    expect(checkSummary.affectedGraphs).toHaveLength(1);
    expect(checkSummary.check?.checkedSubgraphs.length).toEqual(1);
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

    const checkSummary = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: federatedGraphName,
      checkId: checkResp.checkId,
    });

    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);
    expect(checkSummary.affectedGraphs).toHaveLength(1);
    expect(checkSummary.check?.checkedSubgraphs.length).toEqual(1);

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

    const checkSummary = await client.getCheckSummary({
      namespace: DEFAULT_NAMESPACE,
      graphName: federatedGraphName,
      checkId: checkResp.checkId,
    });

    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);
    expect(checkSummary.affectedGraphs).toHaveLength(1);
    expect(checkSummary.check?.checkedSubgraphs.length).toEqual(1);

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

  test('Should test check with delete option', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const fedGraphName = genID('fedGraph');
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const label = genUniqueLabel();

    const subgraph1Schema = `
type Query {
  employees: [Employee!]!
}

type Employee {
  id: Int!
  name: String!
}
`;

    const subgraph2Schema = `
type Query {
  departments: [Department!]!
}

type Department {
  id: Int!
  title: String!
}
`;

    // Create a federated graph
    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // Create and publish first subgraph
    let resp = await client.createFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8082',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      schema: subgraph1Schema,
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    // Create and publish second subgraph
    resp = await client.createFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8083',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      schema: subgraph2Schema,
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    // Now run another check with delete option set to true
    const checkWithDeleteResp = await client.checkSubgraphSchema({
      subgraphName: subgraph1Name,
      namespace: 'default',
      delete: true,
    });
    expect(checkWithDeleteResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkWithDeleteResp.breakingChanges.length).toBeGreaterThan(0);
    expect(checkWithDeleteResp.compositionErrors.length).toBe(0);

    const checkSummary = await client.getCheckSummary({
      namespace: 'default',
      graphName: fedGraphName,
      checkId: checkWithDeleteResp.checkId,
    });
    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);
    expect(checkSummary.check?.checkedSubgraphs).toHaveLength(1);
    expect(checkSummary.check?.checkedSubgraphs[0].isDeleted).toBe(true);
    expect(checkSummary.check?.checkedSubgraphs[0].subgraphName).toBe(subgraph1Name);
    await server.close();
  });

  test('Should run check against a new subgraph that doesnt exist by passing labels to the check', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const fedGraphName = genID('fedGraph');
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const nonexistentSubgraphName = genID('nonexistentSubgraph');
    const label1 = genUniqueLabel();
    const label2 = genUniqueLabel();
    const nonexistentLabel = genUniqueLabel();

    const subgraph1Schema = `
type Query {
  products: [Product!]!
}

type Product {
  id: Int!
  name: String!
}
`;

    const subgraph2Schema = `
type Query {
  categories: [Category!]!
}

type Category {
  id: Int!
  title: String!
}
`;

    // Create a federated graph with multiple label matchers
    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [`${joinLabel(label1)},${joinLabel(label2)}`],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    // Create and publish first subgraph
    let resp = await client.createFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      labels: [label1],
      routingUrl: 'http://localhost:8082',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      schema: subgraph1Schema,
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    // Create and publish second subgraph
    resp = await client.createFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      labels: [label2],
      routingUrl: 'http://localhost:8083',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      schema: subgraph2Schema,
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    let checkResp = await client.checkSubgraphSchema({
      subgraphName: nonexistentSubgraphName,
      labels: [label1],
      namespace: 'default',
      schema: Buffer.from('type Query { nonexistent: String! }'),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.checkedFederatedGraphs).toHaveLength(1);
    expect(checkResp.nonBreakingChanges.length).toBeGreaterThan(0);

    checkResp = await client.checkSubgraphSchema({
      subgraphName: nonexistentSubgraphName,
      labels: [nonexistentLabel],
      namespace: 'default',
      schema: Buffer.from('type Query { nonexistent: String! }'),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.checkedFederatedGraphs).toHaveLength(0);
    expect(checkResp.nonBreakingChanges.length).toBeGreaterThan(0);

    await server.close();
  });

  test('Should check non-existent subgraph with specific labels and match only the corresponding federated graph', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    // Generate unique IDs and labels for test entities
    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const nonExistentSubgraphName = genID('nonExistentSubgraph');

    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');

    // Create fed graph 1 with label1
    const fedGraph1Resp = await client.createFederatedGraph({
      name: fedGraph1Name,
      namespace: 'default',
      labelMatchers: [joinLabel(label1)],
      routingUrl: 'http://localhost:8081',
    });
    expect(fedGraph1Resp.response?.code).toBe(EnumStatusCode.OK);

    // Create fed graph 2 with label2
    const fedGraph2Resp = await client.createFederatedGraph({
      name: fedGraph2Name,
      namespace: 'default',
      labelMatchers: [joinLabel(label2)],
      routingUrl: 'http://localhost:8082',
    });
    expect(fedGraph2Resp.response?.code).toBe(EnumStatusCode.OK);

    // Create subgraph 1 with label1
    const subgraph1Resp = await client.createFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      labels: [label1],
      routingUrl: 'http://localhost:8091',
    });
    expect(subgraph1Resp.response?.code).toBe(EnumStatusCode.OK);

    // Create subgraph 2 with label2
    const subgraph2Resp = await client.createFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      labels: [label2],
      routingUrl: 'http://localhost:8092',
    });
    expect(subgraph2Resp.response?.code).toBe(EnumStatusCode.OK);

    // Publish schemas for the subgraphs
    const publishSubgraph1Resp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      schema: 'type Query { hello1: String! }',
    });
    expect(publishSubgraph1Resp.response?.code).toBe(EnumStatusCode.OK);

    const publishSubgraph2Resp = await client.publishFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      schema: 'type Query { hello2: String! }',
    });
    expect(publishSubgraph2Resp.response?.code).toBe(EnumStatusCode.OK);

    // Run a check against a non-existent subgraph with label1
    const checkResp = await client.checkSubgraphSchema({
      subgraphName: nonExistentSubgraphName,
      namespace: 'default',
      labels: [label1], // Using label1 should match only fedGraph1
      schema: Buffer.from('type Query { newField: String! }'),
    });

    // Verify the check response
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

    // Verify that only fedGraph1 is included in the check
    expect(checkResp.checkedFederatedGraphs).toHaveLength(1);
    expect(checkResp.checkedFederatedGraphs[0].name).toBe(fedGraph1Name);

    // Cleanup
    await server.close();
  });

  test('Should handle composition when one of the subgraphs has an empty schema', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const emptySubgraphName = genID('empty-subgraph');
    const validSubgraphName = genID('valid-subgraph');
    const label = genUniqueLabel();

    // Create federated graph
    const fedGraphName = genID('federated-graph');
    await client.createFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });

    // Create first subgraph with empty schema
    await client.createFederatedSubgraph({
      name: emptySubgraphName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });

    // Create second subgraph with valid schema
    await client.createFederatedSubgraph({
      name: validSubgraphName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
      routingUrl: 'http://localhost:8081',
    });

    // Publish valid schema
    let validSchema = `
    type Query {
      hello: String
    }
  `;
    const publishValidResp = await client.publishFederatedSubgraph({
      name: validSubgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: validSchema,
    });
    expect(publishValidResp.response?.code).toBe(EnumStatusCode.OK);

    validSchema = `
    type Query {
      hello2: String
    }
  `;

    // Check valid subgraph with empty schema
    const checkValidResp = await client.checkSubgraphSchema({
      subgraphName: validSubgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Buffer.from(validSchema),
    });
    expect(checkValidResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkValidResp.compositionErrors.length).toBe(0);
    expect(checkValidResp.breakingChanges.length).toBe(1);

    await server.close();
  });

  test('Should handle check with non-existent subgraph and invalid label', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    // Generate unique IDs and labels
    const fedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
    const nonExistentSubgraphName = genID('nonExistentSubgraph');
    const label = genUniqueLabel('label');
    const invalidLabel = genUniqueLabel('invalid'); // Valid format but not used in any federated graph

    // Create fed graph with label
    const fedGraphResp = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(fedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Create subgraph with label
    const subgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8091',
    });
    expect(subgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Publish schema for the subgraph
    const publishSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: 'type Query { hello: String! }',
    });
    expect(publishSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Check non-existent subgraph with invalid label
    let checkWithInvalidLabelResp = await client.checkSubgraphSchema({
      subgraphName: nonExistentSubgraphName,
      namespace: 'default',
      labels: [{ key: '@#', value: 'test' }], // Using invalid label
      schema: Buffer.from('type Query { newField: String! }'),
    });

    expect(checkWithInvalidLabelResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_LABELS);

    checkWithInvalidLabelResp = await client.checkSubgraphSchema({
      subgraphName: nonExistentSubgraphName,
      namespace: 'default',
      labels: [{ key: 'test', value: '@#' }], // Using invalid label
      schema: Buffer.from('type Query { newField: String! }'),
    });

    expect(checkWithInvalidLabelResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_LABELS);

    checkWithInvalidLabelResp = await client.checkSubgraphSchema({
      subgraphName: nonExistentSubgraphName,
      namespace: 'default',
      labels: [{ key: '@#', value: '@#' }], // Using invalid label
      schema: Buffer.from('type Query { newField: String! }'),
    });

    expect(checkWithInvalidLabelResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_LABELS);

    checkWithInvalidLabelResp = await client.checkSubgraphSchema({
      subgraphName: nonExistentSubgraphName,
      namespace: 'default',
      labels: [{ value: '@#' }], // Using invalid label
      schema: Buffer.from('type Query { newField: String! }'),
    });

    expect(checkWithInvalidLabelResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_LABELS);

    checkWithInvalidLabelResp = await client.checkSubgraphSchema({
      subgraphName: nonExistentSubgraphName,
      namespace: 'default',
      labels: [{ key: '@#' }], // Using invalid label
      schema: Buffer.from('type Query { newField: String! }'),
    });

    expect(checkWithInvalidLabelResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_LABELS);

    // Cleanup
    await server.close();
  });

  test('Should handle check against non existent subgraph with invalid subgraph name', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    // Generate unique IDs and labels
    const fedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
    const invalidSubgraphName = '@#$%'; // Invalid name pattern
    const label = genUniqueLabel('label');

    // Create fed graph with label
    const fedGraphResp = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(fedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Create subgraph with label
    const subgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8091',
    });
    expect(subgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Publish schema for the subgraph
    const publishSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: 'type Query { hello: String! }',
    });
    expect(publishSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Check with invalid subgraph name
    const checkWithInvalidNameResp = await client.checkSubgraphSchema({
      subgraphName: invalidSubgraphName,
      namespace: 'default',
      schema: Buffer.from('type Query { newField: String! }'),
    });

    // Verify the check response for invalid subgraph name
    expect(checkWithInvalidNameResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

    // Cleanup
    await server.close();
  });

  test('Should test that the labels are ignored when the check is against an existing subgraph', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    // Generate unique IDs and labels
    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');

    // Create fed graph 1 with label1
    const fedGraph1Resp = await client.createFederatedGraph({
      name: fedGraph1Name,
      namespace: 'default',
      labelMatchers: [joinLabel(label1)],
      routingUrl: 'http://localhost:8081',
    });
    expect(fedGraph1Resp.response?.code).toBe(EnumStatusCode.OK);

    // Create fed graph 2 with label2
    const fedGraph2Resp = await client.createFederatedGraph({
      name: fedGraph2Name,
      namespace: 'default',
      labelMatchers: [joinLabel(label2)],
      routingUrl: 'http://localhost:8082',
    });
    expect(fedGraph2Resp.response?.code).toBe(EnumStatusCode.OK);

    // Create subgraph 1 with label1
    const subgraph1Resp = await client.createFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      labels: [label1],
      routingUrl: 'http://localhost:8091',
    });
    expect(subgraph1Resp.response?.code).toBe(EnumStatusCode.OK);

    // Create subgraph 2 with label2
    const subgraph2Resp = await client.createFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      labels: [label2],
      routingUrl: 'http://localhost:8092',
    });
    expect(subgraph2Resp.response?.code).toBe(EnumStatusCode.OK);

    // Publish schemas for the subgraphs
    const publishSubgraph1Resp = await client.publishFederatedSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      schema: 'type Query { hello1: String! }',
    });
    expect(publishSubgraph1Resp.response?.code).toBe(EnumStatusCode.OK);

    const publishSubgraph2Resp = await client.publishFederatedSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      schema: 'type Query { hello2: String! }',
    });
    expect(publishSubgraph2Resp.response?.code).toBe(EnumStatusCode.OK);

    // Check subgraph1 but pass labels of fedgraph2
    // This tests when we check an existing subgraph (subgraph1) but pass labels that
    // don't match its original labels. The system should use the original subgraph's
    // labels for federation matching, ignoring the passed labels parameter.
    const checkExistingSubgraphWithDifferentLabelsResp = await client.checkSubgraphSchema({
      subgraphName: subgraph1Name,
      namespace: 'default',
      labels: [label2], // Using label2 which matches fedGraph2, but subgraph1 has label1
      schema: Buffer.from('type Query { updatedField: String! }'),
    });

    // Verify that only fedGraph1 is checked (which matches subgraph1's actual label)
    // and not fedGraph2 (which matches the passed label2)
    expect(checkExistingSubgraphWithDifferentLabelsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkExistingSubgraphWithDifferentLabelsResp.checkedFederatedGraphs).toHaveLength(1);
    expect(checkExistingSubgraphWithDifferentLabelsResp.checkedFederatedGraphs[0].name).toBe(fedGraph1Name);

    // Cleanup
    await server.close();
  });

  describe('Schema check with linked subgraphs', () => {
    test('Should perform schema check on both source and target linked subgraphs', async () => {
      const { client, server } = await SetupTest({ dbname, chClient });

      // Create target namespace (source will use default)
      const targetNamespace = 'prod';
      const createNamespaceResp = await client.createNamespace({
        name: targetNamespace,
      });
      expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

      // Generate unique IDs and labels
      const sourceSubgraphName = genID('source-subgraph');
      const targetSubgraphName = genID('target-subgraph');
      const fedGraphName = genID('fedGraph');
      const sourceLabel = genUniqueLabel('source');
      const targetLabel = genUniqueLabel('target');

      // Create federated graphs for both source and target
      const sourceFedGraphResp = await client.createFederatedGraph({
        name: fedGraphName + '-source',
        namespace: 'default',
        labelMatchers: [joinLabel(sourceLabel)],
        routingUrl: 'http://localhost:8081',
      });
      expect(sourceFedGraphResp.response?.code).toBe(EnumStatusCode.OK);

      const targetFedGraphResp = await client.createFederatedGraph({
        name: fedGraphName + '-target',
        namespace: targetNamespace,
        labelMatchers: [joinLabel(targetLabel)],
        routingUrl: 'http://localhost:8082',
      });
      expect(targetFedGraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Create source subgraph in default namespace
      const createSourceSubgraphResp = await client.createFederatedSubgraph({
        name: sourceSubgraphName,
        namespace: 'default',
        routingUrl: 'http://localhost:8091',
        labels: [sourceLabel],
      });
      expect(createSourceSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Create target subgraph in target namespace
      const createTargetSubgraphResp = await client.createFederatedSubgraph({
        name: targetSubgraphName,
        namespace: targetNamespace,
        routingUrl: 'http://localhost:8092',
        labels: [targetLabel],
      });
      expect(createTargetSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Publish initial schemas for both subgraphs
      const publishSourceResp = await client.publishFederatedSubgraph({
        name: sourceSubgraphName,
        namespace: 'default',
        schema: 'type Query { field: String! }',
      });
      expect(publishSourceResp.response?.code).toBe(EnumStatusCode.OK);

      const publishTargetResp = await client.publishFederatedSubgraph({
        name: targetSubgraphName,
        namespace: targetNamespace,
        schema: 'type Query { field: String! }',
      });
      expect(publishTargetResp.response?.code).toBe(EnumStatusCode.OK);

      // Link the subgraphs (source in default, target in prod)
      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: 'default',
        targetSubgraphName,
        targetSubgraphNamespace: targetNamespace,
      });
      expect(linkResponse.response?.code).toBe(EnumStatusCode.OK);

      // Mock traffic for both subgraphs
      (chClient.queryPromise as Mock)
        .mockResolvedValueOnce([
          {
            operationHash: 'source-hash1',
            operationName: 'sourceOp1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'target-hash1',
            operationName: 'targetOp1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ]);

      // Perform schema check on source subgraph (which should also check target)
      const checkResp = await client.checkSubgraphSchema({
        subgraphName: sourceSubgraphName,
        namespace: 'default',
        schema: Buffer.from('type Query { field: String }'), // Breaking change
      });

      expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
      expect(checkResp.breakingChanges.length).toBe(1);
      expect(checkResp.operationUsageStats?.totalOperations).toBe(1);
      expect(checkResp.isLinkedTrafficCheckFailed).toBe(true);
      expect(checkResp.isLinkedPruningCheckFailed).toBe(false);

      await server.close();
    });

    test('Should handle linked subgraph with no traffic', async () => {
      const { client, server } = await SetupTest({ dbname, chClient });

      // Create target namespace
      const targetNamespace = 'prod';
      await client.createNamespace({ name: targetNamespace });

      const sourceSubgraphName = genID('source-subgraph');
      const targetSubgraphName = genID('target-subgraph');
      const fedGraphName = genID('fedGraph');
      const sourceLabel = genUniqueLabel('source');
      const targetLabel = genUniqueLabel('target');

      // Create federated graphs
      await client.createFederatedGraph({
        name: fedGraphName + '-source',
        namespace: 'default',
        labelMatchers: [joinLabel(sourceLabel)],
        routingUrl: 'http://localhost:8081',
      });

      await client.createFederatedGraph({
        name: fedGraphName + '-target',
        namespace: targetNamespace,
        labelMatchers: [joinLabel(targetLabel)],
        routingUrl: 'http://localhost:8082',
      });

      // Create and publish subgraphs
      await client.createFederatedSubgraph({
        name: sourceSubgraphName,
        namespace: 'default',
        routingUrl: 'http://localhost:8091',
        labels: [sourceLabel],
      });

      await client.createFederatedSubgraph({
        name: targetSubgraphName,
        namespace: targetNamespace,
        routingUrl: 'http://localhost:8092',
        labels: [targetLabel],
      });

      await client.publishFederatedSubgraph({
        name: sourceSubgraphName,
        namespace: 'default',
        schema: 'type Query { field: String! }',
      });

      await client.publishFederatedSubgraph({
        name: targetSubgraphName,
        namespace: targetNamespace,
        schema: 'type Query { field: String! }',
      });

      // Link the subgraphs
      await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: 'default',
        targetSubgraphName,
        targetSubgraphNamespace: targetNamespace,
      });

      // Mock no traffic
      (chClient.queryPromise as Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      // Perform schema check with breaking changes
      const checkResp = await client.checkSubgraphSchema({
        subgraphName: sourceSubgraphName,
        namespace: 'default',
        schema: Buffer.from('type Query { updatedSourceField: String! }'),
      });

      expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
      expect(checkResp.breakingChanges.length).toBeGreaterThan(0);
      expect(checkResp.isLinkedTrafficCheckFailed).toBe(false); // No traffic, so no failure
      expect(checkResp.isLinkedPruningCheckFailed).toBe(false);

      await server.close();
    });

    test('Should skip traffic check for both source and linked subgraphs when skipTrafficCheck is true', async () => {
      const { client, server } = await SetupTest({ dbname, chClient });

      // Create target namespace
      const targetNamespace = 'prod';
      await client.createNamespace({ name: targetNamespace });

      const sourceSubgraphName = genID('source-subgraph');
      const targetSubgraphName = genID('target-subgraph');
      const fedGraphName = genID('fedGraph');
      const sourceLabel = genUniqueLabel('source');
      const targetLabel = genUniqueLabel('target');

      // Create federated graphs
      await client.createFederatedGraph({
        name: fedGraphName + '-source',
        namespace: 'default',
        labelMatchers: [joinLabel(sourceLabel)],
        routingUrl: 'http://localhost:8081',
      });

      await client.createFederatedGraph({
        name: fedGraphName + '-target',
        namespace: targetNamespace,
        labelMatchers: [joinLabel(targetLabel)],
        routingUrl: 'http://localhost:8082',
      });

      // Create and publish subgraphs
      await client.createFederatedSubgraph({
        name: sourceSubgraphName,
        namespace: 'default',
        routingUrl: 'http://localhost:8091',
        labels: [sourceLabel],
      });

      await client.createFederatedSubgraph({
        name: targetSubgraphName,
        namespace: targetNamespace,
        routingUrl: 'http://localhost:8092',
        labels: [targetLabel],
      });

      await client.publishFederatedSubgraph({
        name: sourceSubgraphName,
        namespace: 'default',
        schema: 'type Query { field: String! }',
      });

      await client.publishFederatedSubgraph({
        name: targetSubgraphName,
        namespace: targetNamespace,
        schema: 'type Query { field: String! }',
      });

      // Link the subgraphs
      await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: 'default',
        targetSubgraphName,
        targetSubgraphNamespace: targetNamespace,
      });

      // Mock traffic for both subgraphs
      (chClient.queryPromise as Mock)
        .mockResolvedValueOnce([
          {
            operationHash: 'source-hash1',
            operationName: 'sourceOp1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'target-hash1',
            operationName: 'targetOp1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ]);

      // Perform schema check with skipTrafficCheck enabled
      const checkResp = await client.checkSubgraphSchema({
        subgraphName: sourceSubgraphName,
        namespace: 'default',
        schema: Buffer.from('type Query { updatedSourceField: String! }'),
        skipTrafficCheck: true,
      });

      expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
      expect(checkResp.clientTrafficCheckSkipped).toBe(true);
      expect(checkResp.isLinkedTrafficCheckFailed).toBe(false);
      expect(checkResp.operationUsageStats?.totalOperations).toBe(0);

      await server.close();
    });

    test('Should handle linked subgraph deletion check', async () => {
      const { client, server } = await SetupTest({ dbname, chClient });

      // Create target namespace
      const targetNamespace = 'prod';
      await client.createNamespace({ name: targetNamespace });

      const sourceSubgraphName = genID('source-subgraph');
      const targetSubgraphName = genID('target-subgraph');
      const fedGraphName = genID('fedGraph');
      const sourceLabel = genUniqueLabel('source');
      const targetLabel = genUniqueLabel('target');

      // Create federated graphs
      await client.createFederatedGraph({
        name: fedGraphName + '-source',
        namespace: 'default',
        labelMatchers: [joinLabel(sourceLabel)],
        routingUrl: 'http://localhost:8081',
      });

      await client.createFederatedGraph({
        name: fedGraphName + '-target',
        namespace: targetNamespace,
        labelMatchers: [joinLabel(targetLabel)],
        routingUrl: 'http://localhost:8082',
      });

      // Create and publish subgraphs
      await client.createFederatedSubgraph({
        name: sourceSubgraphName,
        namespace: 'default',
        routingUrl: 'http://localhost:8091',
        labels: [sourceLabel],
      });

      await client.createFederatedSubgraph({
        name: sourceSubgraphName + '2',
        namespace: 'default',
        routingUrl: 'http://localhost:8091',
        labels: [sourceLabel],
      });

      await client.createFederatedSubgraph({
        name: targetSubgraphName,
        namespace: targetNamespace,
        routingUrl: 'http://localhost:8092',
        labels: [targetLabel],
      });

      await client.createFederatedSubgraph({
        name: targetSubgraphName + '2',
        namespace: targetNamespace,
        routingUrl: 'http://localhost:8092',
        labels: [targetLabel],
      });

      await client.publishFederatedSubgraph({
        name: sourceSubgraphName,
        namespace: 'default',
        schema: 'type Query { field: String! }',
      });

      await client.publishFederatedSubgraph({
        name: sourceSubgraphName + '2',
        namespace: 'default',
        schema: 'type Query { field2: String! }',
      });

      await client.publishFederatedSubgraph({
        name: targetSubgraphName,
        namespace: targetNamespace,
        schema: 'type Query { field: String! }',
      });

      await client.publishFederatedSubgraph({
        name: targetSubgraphName + '2',
        namespace: targetNamespace,
        schema: 'type Query { field2: String! }',
      });

      // Link the subgraphs
      await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: 'default',
        targetSubgraphName,
        targetSubgraphNamespace: targetNamespace,
      });

      // Mock traffic - 8 calls for source subgraphs and 8 calls for target subgraphs
      (chClient.queryPromise as Mock)
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ])
        .mockResolvedValueOnce([
          {
            operationHash: 'hash1',
            operationName: 'op1',
            operationType: 'query',
            firstSeen: Date.now() / 1000,
            lastSeen: Date.now() / 1000,
          },
        ]);

      // Perform deletion check
      const checkResp = await client.checkSubgraphSchema({
        subgraphName: sourceSubgraphName,
        namespace: 'default',
        delete: true,
      });

      expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
      expect(checkResp.breakingChanges.length).toBeGreaterThan(0); // Deletion causes breaking changes
      expect(checkResp.isLinkedTrafficCheckFailed).toBe(true);

      await server.close();
    });
  });
});
