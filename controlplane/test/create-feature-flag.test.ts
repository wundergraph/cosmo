import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { createBaseAndFeatureGraph, createSubgraph, SetupTest } from './test-util.js';

let dbname = '';

describe('Create feature flag tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature flag can be created with a feature graph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureGraphName = genID('featureGraph');

    await createBaseAndFeatureGraph(client, subgraphName, featureGraphName, 'http://localhost:4001', 'http://localhost:4002');

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      featureFlagName: flagName,
      featureGraphNames: [featureGraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that an error is returned if a feature flag is created without any feature graphs', async () => {
    const { client, server } = await SetupTest({ dbname });

    const flagName = genID('flag');
    const featureFlagResponse = await client.createFeatureFlag({
      featureFlagName: flagName,
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureFlagResponse.response?.details).toBe('At least one feature graph is required to create a feature flag.');

    await server.close();
  });

  test('that an error is returned if a duplicate feature flag is created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureGraphName = genID('featureGraph');

    await createBaseAndFeatureGraph(client, subgraphName, featureGraphName, 'http://localhost:4001', 'http://localhost:4002');

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      featureFlagName: flagName,
      featureGraphNames: [featureGraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const featureFlagResponseTwo = await client.createFeatureFlag({
      featureFlagName: flagName,
      featureGraphNames: [featureGraphName],
    });

    expect(featureFlagResponseTwo.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(featureFlagResponseTwo.response?.details).toBe(`Feature flag "${flagName}" already exists in the namespace "default".`);

    await server.close();
  });

  test('that an error is returned if a feature graph cannot be found when creating a feature flag', async () => {
    const { client, server } = await SetupTest({ dbname });

    const featureGraphName = genID('featureGraph');
    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      featureFlagName: flagName,
      featureGraphNames: [featureGraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(featureFlagResponse.response?.details).toBe(`Feature graph "${featureGraphName}" not found.\n`);

    await server.close();
  });

  test('that an error is returned if a non-feature graph is used to create a feature flag', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      featureFlagName: flagName,
      featureGraphNames: [subgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(featureFlagResponse.response?.details).toBe(`Feature graph "${subgraphName}" not found.\n`);

    await server.close();
  });

  test('that an error is returned if the feature graph does not exist in the same namespace as the feature flag', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureGraphName = genID('featureGraph');

    await createBaseAndFeatureGraph(client, subgraphName, featureGraphName, 'http://localhost:4001', 'http://localhost:4002');

    const namespaceResponse = await client.createNamespace({
      name: 'features',
    });

    expect(namespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      featureFlagName: flagName,
      namespace: 'features',
      featureGraphNames: [featureGraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(featureFlagResponse.response?.details).toBe(`Feature graph "${featureGraphName}" not found.\n`);

    await server.close();
  });
});
