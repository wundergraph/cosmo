import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { createBaseAndFeatureGraph, createFeatureFlag, SetupTest } from './test-util.js';

let dbname = '';

describe('Update feature flag tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature flag can be updated', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureGraphName = genID('featureGraph');

    await createBaseAndFeatureGraph(client, subgraphName, featureGraphName, 'http://localhost:4001', 'http://localhost:4002');

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureGraphName])

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      featureFlagName,
      featureGraphNames: [featureGraphName],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that a feature flag can be updated with another feature graph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureGraphName = genID('featureGraph');

    await createBaseAndFeatureGraph(client, subgraphName, featureGraphName, 'http://localhost:4001', 'http://localhost:4002');

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureGraphName])

    const subgraphNameTwo = genID('subgraph');
    const featureGraphNameTwo = genID('featureGraph');

    await createBaseAndFeatureGraph(client, subgraphNameTwo, featureGraphNameTwo, 'http://localhost:4001', 'http://localhost:4002');

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      featureFlagName,
      featureGraphNames: [featureGraphName, featureGraphNameTwo],
    });

    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that an error is returned if a feature flag that does not exist is updated', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureGraphName = genID('featureGraph');

    await createBaseAndFeatureGraph(client, subgraphName, featureGraphName, 'http://localhost:4001', 'http://localhost:4002');

    const featureFlagName = genID('flag');

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      featureFlagName,
      featureGraphNames: [featureGraphName],
    });

    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(updateFeatureFlagResponse.response?.details)
      .toBe(`Feature flag "${featureFlagName}" does not exists in the namespace "default".`);

    await server.close();
  });
});
