import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  TestUser
} from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  createNamespace,
  createSubgraph,
  DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Create feature flag tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an error is returned if a feature flag is created without any feature subgraphs', async () => {
    const { client, server } = await SetupTest({ dbname });

    const flagName = genID('flag');
    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureFlagResponse.response?.details)
      .toBe('At least one feature subgraph is required to create a feature flag.');

    await server.close();
  });

  test('that an error is returned if a duplicate feature flag is created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const featureFlagResponseTwo = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(featureFlagResponseTwo.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(featureFlagResponseTwo.response?.details)
      .toBe(`The feature flag "${flagName}" already exists in the namespace "default".`);

    await server.close();
  });

  test('that an error is returned if a feature subgraph cannot be found when creating a feature flag', async () => {
    const { client, server } = await SetupTest({ dbname });

    const featureSubgraphName = genID('featureSubgraph');
    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureFlagResponse.response?.details)
      .toBe(`1. The feature subgraph "${featureSubgraphName}" was not found.`);

    await server.close();
  });

  test('that an error is returned if a non-feature subgraph is used to create a feature flag', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [subgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureFlagResponse.response?.details)
      .toBe(`1. The subgraph "${subgraphName}" is not a feature subgraph.`);

    await server.close();
  });

  test('that an error is returned if the feature subgraph does not exist in the same namespace as the feature flag', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      namespace,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureFlagResponse.response?.details)
      .toBe(`1. The feature subgraph "${featureSubgraphName}" was not found.`);

    await server.close();
  });

  test('that an error is returned if a feature flag contains duplicate feature subgraphs', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_TWO);

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName, featureSubgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureFlagResponse.response?.details)
      .toBe('1. Feature subgraphs with the same base subgraph cannot compose the same feature flag.');

    await server.close();
  });

  test('that an error is returned if a feature flag contains feature subgraphs that share the same base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphNameOne = genID('featureSubgraphOne');
    const featureSubgraphNameTwo = genID('featureSubgraphTwo');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_TWO);

    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphNameTwo,
      routingUrl: 'http://localhost:4004',
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphNameOne, featureSubgraphNameTwo],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureFlagResponse.response?.details)
      .toBe('1. Feature subgraphs with the same base subgraph cannot compose the same feature flag.');

    await server.close();
  });

  test.each([
    'organization-admin',
    'organization-developer',
  ])('%s should be able to create feature graph with a feature subgraph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_TWO);

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should not be able to create feature flag', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_TWO);

    const flagName = genID('flag');

    authenticator.changeUserWithSuppliedContext({
      ...users[TestUser.adminAliceCompanyA],
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });
});
