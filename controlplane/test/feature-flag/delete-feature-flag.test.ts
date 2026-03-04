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
  createFeatureFlag,
  createNamespace,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Delete feature flag tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an error is returned when attempting to delete a feature flag that does not exist', async () => {
    const { client, server } = await SetupTest({ dbname });

    const featureFlagName = genID('flag');
    // Attempting to delete the feature flag again should result in a not found error
    const deleteFeatureFlagResponseTwo = await client.deleteFeatureFlag({ name: featureFlagName });
    expect(deleteFeatureFlagResponseTwo.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(deleteFeatureFlagResponseTwo.response?.details).toBe(`The feature flag "${featureFlagName}" was not found.`);

    await server.close();
  });

  test('that an error is returned when trying to delete a feature subgraph that is not in the namespace specified', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
      namespace,
    );

    const featureFlagName = genID('flag');

    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName], namespace);

    const deleteFeatureFlagResponseOne = await client.deleteFeatureFlag({ name: featureFlagName });
    expect(deleteFeatureFlagResponseOne.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(deleteFeatureFlagResponseOne.response?.details)
      .toBe(`The feature flag "${featureFlagName}" was not found.`);

    // Providing the namespace should delete the feature flag successfully
    const deleteFeatureFlagResponseTwo = await client.deleteFeatureFlag({ name: featureFlagName, namespace });
    expect(deleteFeatureFlagResponseTwo.response?.code).toBe(EnumStatusCode.OK);

    // Attempting to delete the feature flag again should result in a not found error
    const deleteFeatureFlagResponseThree = await client.deleteFeatureFlag({ name: featureFlagName, namespace });
    expect(deleteFeatureFlagResponseThree.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(deleteFeatureFlagResponseThree.response?.details)
      .toBe(`The feature flag "${featureFlagName}" was not found.`);

    await server.close();
  });

  test.each([
    'organization-admin',
    'organization-developer',
  ])('%s should be able to delete feature flag', async (role) => {
    const { client, server, users, authenticator } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const deleteFeatureFlagResponseOne = await client.deleteFeatureFlag({ name: featureFlagName });
    expect(deleteFeatureFlagResponseOne.response?.code).toBe(EnumStatusCode.OK);

    // attempting to delete the feature flag again should result in a not found error
    const deleteFeatureFlagResponseTwo = await client.deleteFeatureFlag({ name: featureFlagName });
    expect(deleteFeatureFlagResponseTwo.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(deleteFeatureFlagResponseTwo.response?.details)
      .toBe(`The feature flag "${featureFlagName}" was not found.`);

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
    const { client, server, users, authenticator } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const deleteFeatureFlagResponseOne = await client.deleteFeatureFlag({ name: featureFlagName });
    expect(deleteFeatureFlagResponseOne.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });
});
