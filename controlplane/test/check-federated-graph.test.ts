import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { allExternalFieldInstancesError, noBaseDefinitionForExtensionError, OBJECT } from '@wundergraph/composition';
import { joinLabel } from '@wundergraph/cosmo-shared';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel
} from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { DEFAULT_NAMESPACE, SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('CheckFederatedGraph', (ctx) => {
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

  test.each([
    'organization-admin',
    'organization-developer',
  ])('%s should be able to create a federated graph, subgraphs, publish the schema and then check the graph for composition errors', async (role) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');

    const pandasSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));
    const productsSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/products.graphql'));
    const usersSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/users.graphql'));

    const pandasSchema = new TextDecoder().decode(pandasSchemaBuffer);
    const productsSchema = new TextDecoder().decode(productsSchemaBuffer);
    const usersSchema = new TextDecoder().decode(usersSchemaBuffer);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role }))
    })

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: 'pandas',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8081',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    let publishResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      namespace: DEFAULT_NAMESPACE,
      schema: pandasSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'users',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'users',
      namespace: DEFAULT_NAMESPACE,
      schema: usersSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'products',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'B' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'products',
      namespace: DEFAULT_NAMESPACE,
      schema: productsSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    let checkResp = await client.checkFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors).toHaveLength(0);

    checkResp = await client.checkFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=B'],
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(checkResp.compositionErrors).toHaveLength(2);
    expect(checkResp.compositionErrors[0].message).toBe(noBaseDefinitionForExtensionError(OBJECT, 'User').message);
    expect(checkResp.compositionErrors[1].message).toBe(
      allExternalFieldInstancesError(
        'User',
        new Map<string, Array<string>>([
          ['totalProductsCreated', ['products']],
        ]),
      ).message,
    );

    await server.close();
  });

  test('Should be able to create a federated graph, subgraphs, publish the schema and then check the graph for composition errors when using legacy API key', async (role) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');

    const pandasSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));
    const productsSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/products.graphql'));
    const usersSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/users.graphql'));

    const pandasSchema = new TextDecoder().decode(pandasSchemaBuffer);
    const productsSchema = new TextDecoder().decode(productsSchemaBuffer);
    const usersSchema = new TextDecoder().decode(usersSchemaBuffer);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator()
    })

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: 'pandas',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8081',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    let publishResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      namespace: DEFAULT_NAMESPACE,
      schema: pandasSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'users',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'users',
      namespace: DEFAULT_NAMESPACE,
      schema: usersSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'products',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'B' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'products',
      namespace: DEFAULT_NAMESPACE,
      schema: productsSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    let checkResp = await client.checkFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors).toHaveLength(0);

    checkResp = await client.checkFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=B'],
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(checkResp.compositionErrors).toHaveLength(2);
    expect(checkResp.compositionErrors[0].message).toBe(noBaseDefinitionForExtensionError(OBJECT, 'User').message);
    expect(checkResp.compositionErrors[1].message).toBe(
      allExternalFieldInstancesError(
        'User',
        new Map<string, Array<string>>([
          ['totalProductsCreated', ['products']],
        ]),
      ).message,
    );

    await server.close();
  });

  test('graph-admin should be able to check the graph for composition errors on allowed namespaces', async (role) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');

    const pandasSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));
    const productsSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/products.graphql'));
    const usersSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/users.graphql'));

    const pandasSchema = new TextDecoder().decode(pandasSchemaBuffer);
    const productsSchema = new TextDecoder().decode(productsSchemaBuffer);
    const usersSchema = new TextDecoder().decode(usersSchemaBuffer);

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: 'pandas',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8081',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    let publishResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      namespace: DEFAULT_NAMESPACE,
      schema: pandasSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'users',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'users',
      namespace: DEFAULT_NAMESPACE,
      schema: usersSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'products',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'B' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'products',
      namespace: DEFAULT_NAMESPACE,
      schema: productsSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role: 'graph-admin' }))
    });

    let checkResp = await client.checkFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors).toHaveLength(0);

    checkResp = await client.checkFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=B'],
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(checkResp.compositionErrors).toHaveLength(2);
    expect(checkResp.compositionErrors[0].message).toBe(noBaseDefinitionForExtensionError(OBJECT, 'User').message);
    expect(checkResp.compositionErrors[1].message).toBe(
      allExternalFieldInstancesError(
        'User',
        new Map<string, Array<string>>([
          ['totalProductsCreated', ['products']],
        ]),
      ).message,
    );

    await server.close();
  });

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not be able to check graphs for composition errors', async (role) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');

    const pandasSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));
    const productsSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/products.graphql'));
    const usersSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/users.graphql'));

    const pandasSchema = new TextDecoder().decode(pandasSchemaBuffer);
    const productsSchema = new TextDecoder().decode(productsSchemaBuffer);
    const usersSchema = new TextDecoder().decode(usersSchemaBuffer);

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: 'pandas',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8081',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    let publishResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      namespace: DEFAULT_NAMESPACE,
      schema: pandasSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'users',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'users',
      namespace: DEFAULT_NAMESPACE,
      schema: usersSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'products',
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'B' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'products',
      namespace: DEFAULT_NAMESPACE,
      schema: productsSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role }))
    });

    const checkResp = await client.checkFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

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
    const checkValidResp = await client.checkFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: [joinLabel(label)],
    });
    expect(checkValidResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkValidResp.compositionErrors.length).toBe(0);
    expect(checkValidResp.subgraphs.length).toBe(1);
    expect(checkValidResp.subgraphs[0].name).toBe(validSubgraphName);

    await server.close();
  });
});
