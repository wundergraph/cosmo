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

  describe('Federated graph check with limit parameter', () => {
    test('Should return all composition errors when no limit is provided', async () => {
      const { client, server } = await SetupTest({ dbname, chClient });

      const federatedGraphName = genID('fedGraph');
      const productsSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/products.graphql'));
      const productsSchema = new TextDecoder().decode(productsSchemaBuffer);

      await client.createFederatedGraph({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
        labelMatchers: ['team=B'],
        routingUrl: 'http://localhost:8080',
      });

      await client.createFederatedSubgraph({
        name: 'products',
        namespace: DEFAULT_NAMESPACE,
        labels: [{ key: 'team', value: 'B' }],
        routingUrl: 'http://localhost:8082',
      });

      await client.publishFederatedSubgraph({
        name: 'products',
        namespace: DEFAULT_NAMESPACE,
        schema: productsSchema,
      });

      // Check without limit - should have 2 composition errors
      const checkResp = await client.checkFederatedGraph({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
        labelMatchers: ['team=B'],
        // No limit provided
      });

      expect(checkResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
      expect(checkResp.compositionErrors.length).toBe(2);
      // Counts should reflect the actual total
      expect(checkResp.counts?.compositionErrors).toBe(2);
      expect(checkResp.counts?.compositionWarnings).toBeGreaterThanOrEqual(0);

      await server.close();
    });

    test('Should limit composition errors when limit is provided', async () => {
      const { client, server } = await SetupTest({ dbname, chClient });

      const federatedGraphName = genID('fedGraph');
      const productsSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/products.graphql'));
      const productsSchema = new TextDecoder().decode(productsSchemaBuffer);

      await client.createFederatedGraph({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
        labelMatchers: ['team=B'],
        routingUrl: 'http://localhost:8080',
      });

      await client.createFederatedSubgraph({
        name: 'products',
        namespace: DEFAULT_NAMESPACE,
        labels: [{ key: 'team', value: 'B' }],
        routingUrl: 'http://localhost:8082',
      });

      await client.publishFederatedSubgraph({
        name: 'products',
        namespace: DEFAULT_NAMESPACE,
        schema: productsSchema,
      });

      // Check with limit of 1
      const checkResp = await client.checkFederatedGraph({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
        labelMatchers: ['team=B'],
        limit: 1,
      });

      expect(checkResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
      // Should only return 1 error
      expect(checkResp.compositionErrors.length).toBe(1);
      // But counts should reflect the actual total
      expect(checkResp.counts?.compositionErrors).toBe(2);

      await server.close();
    });

    test('Should limit composition warnings when limit is provided', async () => {
      const { client, server } = await SetupTest({ dbname, chClient });

      const federatedGraphName = genID('fedGraph');
      const label = genUniqueLabel();

      await client.createFederatedGraph({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
        labelMatchers: [joinLabel(label)],
        routingUrl: 'http://localhost:8080',
      });

      const subgraph1Name = genID('subgraph1');
      const subgraph2Name = genID('subgraph2');

      await client.createFederatedSubgraph({
        name: subgraph1Name,
        namespace: DEFAULT_NAMESPACE,
        labels: [label],
        routingUrl: 'http://localhost:8081',
      });

      await client.createFederatedSubgraph({
        name: subgraph2Name,
        namespace: DEFAULT_NAMESPACE,
        labels: [label],
        routingUrl: 'http://localhost:8082',
      });

      // Publish schemas that will cause composition warnings
      await client.publishFederatedSubgraph({
        name: subgraph1Name,
        namespace: DEFAULT_NAMESPACE,
        schema: `
          type Query {
            field1: String @deprecated(reason: "Use field2 instead")
            field2: String @deprecated(reason: "Use field3 instead")
            field3: String
          }
        `,
      });

      await client.publishFederatedSubgraph({
        name: subgraph2Name,
        namespace: DEFAULT_NAMESPACE,
        schema: 'type Query { otherField: String }',
      });

      // Check with limit of 1
      const checkResp = await client.checkFederatedGraph({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
        labelMatchers: [joinLabel(label)],
        limit: 1,
      });

      expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
      // Should limit warnings to 1
      expect(checkResp.compositionWarnings.length).toBeLessThanOrEqual(1);
      // Counts should still reflect actual totals
      expect(checkResp.counts?.compositionWarnings).toBeGreaterThanOrEqual(0);

      await server.close();
    });

    test('Should return counts object even when composition succeeds', async () => {
      const { client, server } = await SetupTest({ dbname, chClient });

      const federatedGraphName = genID('fedGraph');
      const pandasSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));
      const usersSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/users.graphql'));

      const pandasSchema = new TextDecoder().decode(pandasSchemaBuffer);
      const usersSchema = new TextDecoder().decode(usersSchemaBuffer);

      await client.createFederatedGraph({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
        labelMatchers: ['team=A'],
        routingUrl: 'http://localhost:8080',
      });

      await client.createFederatedSubgraph({
        name: 'pandas',
        namespace: DEFAULT_NAMESPACE,
        labels: [{ key: 'team', value: 'A' }],
        routingUrl: 'http://localhost:8081',
      });

      await client.publishFederatedSubgraph({
        name: 'pandas',
        namespace: DEFAULT_NAMESPACE,
        schema: pandasSchema,
      });

      await client.createFederatedSubgraph({
        name: 'users',
        namespace: DEFAULT_NAMESPACE,
        labels: [{ key: 'team', value: 'A' }],
        routingUrl: 'http://localhost:8082',
      });

      await client.publishFederatedSubgraph({
        name: 'users',
        namespace: DEFAULT_NAMESPACE,
        schema: usersSchema,
      });

      const checkResp = await client.checkFederatedGraph({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
        labelMatchers: ['team=A'],
        limit: 10,
      });

      expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
      expect(checkResp.compositionErrors.length).toBe(0);
      // Counts should be present
      expect(checkResp.counts).toBeDefined();
      expect(checkResp.counts?.compositionErrors).toBe(0);
      expect(checkResp.counts?.compositionWarnings).toBeGreaterThanOrEqual(0);
      expect(checkResp.counts?.lintWarnings).toBe(0);
      expect(checkResp.counts?.lintErrors).toBe(0);
      expect(checkResp.counts?.breakingChanges).toBe(0);
      expect(checkResp.counts?.nonBreakingChanges).toBe(0);
      expect(checkResp.counts?.graphPruneErrors).toBe(0);
      expect(checkResp.counts?.graphPruneWarnings).toBe(0);

      await server.close();
    });

    test('Should clamp limit to maximum allowed value', async () => {
      const { client, server } = await SetupTest({ dbname, chClient });

      const federatedGraphName = genID('fedGraph');
      const subgraphName = genID('subgraph');
      const label = genUniqueLabel();

      await client.createFederatedGraph({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
        labelMatchers: [joinLabel(label)],
        routingUrl: 'http://localhost:8080',
      });

      await client.createFederatedSubgraph({
        name: subgraphName,
        namespace: DEFAULT_NAMESPACE,
        labels: [label],
        routingUrl: 'http://localhost:8081',
      });

      await client.publishFederatedSubgraph({
        name: subgraphName,
        namespace: DEFAULT_NAMESPACE,
        schema: 'type Query { hello: String }',
      });

      // Pass a limit greater than the max (100,000)
      const checkResp = await client.checkFederatedGraph({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
        labelMatchers: [joinLabel(label)],
        limit: 200_000,
      });

      // Should still work, limit will be clamped to 100,000
      expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
      expect(checkResp.counts).toBeDefined();

      await server.close();
    });

    test('Should clamp limit of 0 to minimum of 1', async () => {
      const { client, server } = await SetupTest({ dbname, chClient });

      const federatedGraphName = genID('fedGraph');
      const productsSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/products.graphql'));
      const productsSchema = new TextDecoder().decode(productsSchemaBuffer);

      await client.createFederatedGraph({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
        labelMatchers: ['team=B'],
        routingUrl: 'http://localhost:8080',
      });

      await client.createFederatedSubgraph({
        name: 'products',
        namespace: DEFAULT_NAMESPACE,
        labels: [{ key: 'team', value: 'B' }],
        routingUrl: 'http://localhost:8082',
      });

      await client.publishFederatedSubgraph({
        name: 'products',
        namespace: DEFAULT_NAMESPACE,
        schema: productsSchema,
      });

      // Pass a limit of 0 - should be clamped to minimum of 1
      const checkResp = await client.checkFederatedGraph({
        name: federatedGraphName,
        namespace: DEFAULT_NAMESPACE,
        labelMatchers: ['team=B'],
        limit: 0,
      });

      expect(checkResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
      // When limit is 0, it gets clamped to minimum of 1
      expect(checkResp.compositionErrors.length).toBe(1);
      // Counts should reflect the actual total
      expect(checkResp.counts?.compositionErrors).toBe(2);

      await server.close();
    });
  });
});
