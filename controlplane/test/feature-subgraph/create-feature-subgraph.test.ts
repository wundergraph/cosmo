import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
} from '../../src/core/test-util.js';
import {
  createNamespace,
  createSubgraph,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
  createThenPublishSubgraph,
  createFederatedGraph,
  DEFAULT_ROUTER_URL,
  DEFAULT_NAMESPACE,
} from '../test-util.js';

let dbname = '';

// Helper function to enable proposals for namespace
async function enableProposalsForNamespace(client: any, namespace = 'default') {
  const enableResponse = await client.enableProposalsForNamespace({
    namespace,
    enableProposals: true,
  });

  return enableResponse;
}

describe('Create feature subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an error is returned if a feature subgraph is created without a base graph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('A feature subgraph requires a base subgraph.');

    await server.close();
  });

  test('that an error is returned if the base graph does not exist in the same namespace', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      namespace,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureSubgraphResponse.response?.details).toBe(
      `Base subgraph "${subgraphName}" does not exist in the namespace "${namespace}".`,
    );

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created without a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      isFeatureSubgraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('A non-Event-Driven Graph must define a routing URL');

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created with the same name as its base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: subgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(featureSubgraphResponse.response?.details).toBe(
      `A subgraph with the name "${subgraphName}" already exists in the namespace "default".`,
    );

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created with the same name as another subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const subgraphNameTwo = genID('subgraphTwo');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);
    await createSubgraph(client, subgraphNameTwo, DEFAULT_SUBGRAPH_URL_TWO);

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: subgraphNameTwo,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(featureSubgraphResponse.response?.details).toBe(
      `A subgraph with the name "${subgraphNameTwo}" already exists in the namespace "default".`,
    );

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created with the same name as another feature subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponseOne = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.OK);

    const featureSubgraphResponseTwo = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
    });
    expect(featureSubgraphResponseTwo.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(featureSubgraphResponseTwo.response?.details).toBe(
      `A feature subgraph with the name "${featureSubgraphName}" already exists in the namespace "default".`,
    );

    await server.close();
  });

  test('that a feature subgraph can be created and published with one command.', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponseOne = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
      schema: 'type Query { hello: String }',
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });

    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);

    await server.close();
  });

  test('that a feature subgraph with out base subgraph cannot be created and published with one command.', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponseOne = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      schema: 'type Query { hello: String }',
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(featureSubgraphResponseOne.response?.details).toBe(
      `Feature Subgraph ${featureSubgraphName} not found. If intended to create and publish, please pass the name of the base subgraph with --subgraph option.`,
    );

    await server.close();
  });

  test('that a feature subgraph with out a valid routing url cannot be created and published with one command.', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponseOne = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
      schema: 'type Query { hello: String }',
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureSubgraphResponseOne.response?.details).toBe(
      `A valid, non-empty routing URL is required to create and publish a feature subgraph.`,
    );

    await server.close();
  });

  test('that a feature subgraph can be published even without a proposal', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'enterprise' },
      enabledFeatures: ['proposals'],
    });

    // Setup: create a base subgraph and a federated graph
    const baseSubgraphName = genID('baseSubgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const proposalName = genID('proposal');

    const baseSubgraphSDL = `
      type Query {
        products: [Product!]!
      }
      
      type Product {
        id: ID!
        name: String!
      }
    `;

    // Create and publish the base subgraph
    await createThenPublishSubgraph(
      client,
      baseSubgraphName,
      'default',
      baseSubgraphSDL,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Create federated graph
    await createFederatedGraph(client, fedGraphName, 'default', [joinLabel(label)], DEFAULT_ROUTER_URL);

    // Enable proposals for the namespace
    const enableResponse = await enableProposalsForNamespace(client);
    expect(enableResponse.response?.code).toBe(EnumStatusCode.OK);

    const featureSubgraphSDL = `
      type Query {
        products: [Product!]!
        product(id: ID!): Product
      }
      
      type Product {
        id: ID!
        name: String!
        price: Float!
        description: String
      }
    `;

    // First, create the feature subgraph
    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName,
      labels: [label]
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Publish the feature subgraph
    const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      schema: featureSubgraphSDL,
    });
    expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test.each([
    'organization-admin',
    'organization-developer',
    'subgraph-admin',
  ])('%s should be able to create feature subgraph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });

    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);

    await server.close();
  });

  test('subgraph-admin should be able to crete feature subgraph only on the allowed namespace', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const namespace = 'prod2';
    const subgraphName = genID('subgraph');
    const subgraphName2 = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const featureSubgraphName2 = genID('featureSubgraph');

    await createNamespace(client, namespace);
    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);
    await createSubgraph(client, subgraphName2, DEFAULT_SUBGRAPH_URL_ONE, namespace);

    const getNamespaceResponse = await client.getNamespace({ name: DEFAULT_NAMESPACE });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'subgraph-admin',
        namespaces: [getNamespaceResponse.namespace!.id],
      })),
    });

    let featureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });

    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);

    // Make sure we can't create a feature subgraph on an unauthorized namespace
    featureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName2,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName2,
      namespace,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not be able to create feature subgraph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });
});
