import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  createFeatureFlag, DEFAULT_NAMESPACE,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Update feature flag tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an error is returned if a feature flag that does not exist is updated', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const featureFlagName = genID('flag');

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(updateFeatureFlagResponse.response?.details)
      .toBe(`The feature flag "${featureFlagName}" does not exist in the namespace "default".`);

    await server.close();
  });

  test('that an error is returned if a feature flag is updated to contain duplicate feature subgraphs', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_TWO);

    const featureFlagName = genID('flag');

    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName, featureSubgraphName],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(updateFeatureFlagResponse.response?.details)
      .toBe('1. Feature subgraphs with the same base subgraph cannot compose the same feature flag.');

    await server.close();
  });

  test('that an error is returned if a feature flag is updated to contain feature subgraphs that share the same base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphNameOne = genID('featureSubgraphOne');
    const featureSubgraphNameTwo = genID('featureSubgraphTwo');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_TWO);

    const featureFlagName = genID('flag');

    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphNameOne]);

    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphNameTwo,
      routingUrl: 'http://localhost:4004',
      baseSubgraphName: subgraphName,
      isFeatureSubgraph: true,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphNameOne, featureSubgraphNameTwo],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(updateFeatureFlagResponse.response?.details)
      .toBe('1. Feature subgraphs with the same base subgraph cannot compose the same feature flag.');

    await server.close();
  });

  test('that an error is returned if a feature flag is updated to contain a base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_TWO);

    const featureFlagName = genID('flag');

    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [subgraphName],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(updateFeatureFlagResponse.response?.details)
      .toBe(`1. The subgraph "${subgraphName}" is not a feature subgraph.`);

    await server.close();
  });

  test('that updating a feature flag feature subgraphs array does not affect already set labels', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphNameOne = genID('featureSubgraphOne');
    const featureSubgraphNameTwo = genID('featureSubgraphTwo');
    const labels = [{ key: 'team', value: 'A' }];

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, labels, [featureSubgraphNameOne]);

    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphNameTwo,
      routingUrl: 'http://localhost:4004',
      baseSubgraphName: subgraphName,
      isFeatureSubgraph: true,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphNameTwo],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureFlagResponse = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureFlagResponse.featureSubgraphs.map((featureSubraph) => featureSubraph.name))
      .toStrictEqual([featureSubgraphNameTwo]);
    expect(getFeatureFlagResponse.featureFlag?.labels).toEqual(labels);

    await server.close();
  });

  test('that updating a feature flag with labels does not affect the feature subgraphs array', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const labels = [{ key: 'team', value: 'A' }];

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName])

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      labels,
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureFlagResponse = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureFlagResponse.featureSubgraphs.map((featureSubgraph) => featureSubgraph.name))
      .toStrictEqual([featureSubgraphName]);
    expect(getFeatureFlagResponse.featureFlag?.labels).toEqual(labels);

    await server.close();
  });

  test('that updating a feature flag with unset labels removes all existing labels', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const labels = [{ key: 'team', value: 'A' }];

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, labels, [featureSubgraphName])

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      unsetLabels: true,
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureFlagResponse = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureFlagResponse.featureSubgraphs.map((featureSubgraph) => featureSubgraph.name))
      .toStrictEqual([featureSubgraphName]);
    expect(getFeatureFlagResponse.featureFlag?.labels).toStrictEqual([]);

    await server.close();
  });

  test('that updating a feature flag with unset labels removes all existing labels and ignores new labels', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphNameOne = genID('featureSubgraphOne');
    const featureSubgraphNameTwo = genID('featureSubgraphTwo');
    const labels = [{ key: 'team', value: 'A' }];

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, labels, [featureSubgraphNameOne])

    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphNameTwo,
      routingUrl: 'http://localhost:4004',
      baseSubgraphName: subgraphName,
      isFeatureSubgraph: true,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      labels: [{ key: 'team', value: 'B' }],
      featureSubgraphNames: [featureSubgraphNameTwo],
      unsetLabels: true,
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureFlagResponse = await client.getFeatureFlagByName({
      name: featureFlagName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureFlagResponse.featureSubgraphs.map((featureSubgraph) => featureSubgraph.name))
      .toStrictEqual([featureSubgraphNameTwo]);
    expect(getFeatureFlagResponse.featureFlag?.labels).toStrictEqual([]);

    await server.close();
  });

  test.each([
    'organization-admin',
    'organization-developer',
  ])('%s should be able to update feature flag', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test.each([
    'organization-admin',
    'organization-developer',
  ])('%s should be able to update feature flag can be updated with another feature subgraph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName])

    const subgraphNameTwo = genID('subgraph');
    const featureSubgraphNameTwo = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphNameTwo, featureSubgraphNameTwo, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName, featureSubgraphNameTwo],
    });

    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

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
  ])('%s should not be able to update feature flag', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });
});
