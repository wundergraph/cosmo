import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import {
  createBaseAndFeatureGraph,
  createFeatureFlag,
  createNamespace,
  SetupTest,
} from './test-util.js';

let dbname = '';

describe('Delete feature flag tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature flag can be deleted', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureGraphName = genID('featureGraph');

    await createBaseAndFeatureGraph(client, subgraphName, featureGraphName, 'http://localhost:4001', 'http://localhost:4002');

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureGraphName]);

    const deleteFeatureFlagResponseOne = await client.deleteFeatureFlag({ featureFlagName });
    expect(deleteFeatureFlagResponseOne.response?.code).toBe(EnumStatusCode.OK);

    // attempting to delete the feature flag again should result in a not found error
    const deleteFeatureFlagResponseTwo = await client.deleteFeatureFlag({ featureFlagName });
    expect(deleteFeatureFlagResponseTwo.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(deleteFeatureFlagResponseTwo.response?.details).toBe(`Feature flag "${featureFlagName}" not found.`);

    await server.close();
  });

  test('that an error is returned when attempting to delete a feature flag that does not exist', async () => {
    const { client, server } = await SetupTest({ dbname });

    const featureFlagName = genID('flag');
    // Attempting to delete the feature flag again should result in a not found error
    const deleteFeatureFlagResponseTwo = await client.deleteFeatureFlag({ featureFlagName });
    expect(deleteFeatureFlagResponseTwo.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(deleteFeatureFlagResponseTwo.response?.details).toBe(`Feature flag "${featureFlagName}" not found.`);

    await server.close();
  });

  test('that an error is returned when trying to delete a feature graph that is not in the namespace specified', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureGraphName = genID('featureGraph');

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);

    await createBaseAndFeatureGraph(
      client,
      subgraphName,
      featureGraphName,
      'http://localhost:4001',
      'http://localhost:4002',
      namespace,
    );

    const featureFlagName = genID('flag');

    await createFeatureFlag(client, featureFlagName, [], [featureGraphName], namespace);

    const deleteFeatureFlagResponseOne = await client.deleteFeatureFlag({ featureFlagName });
    expect(deleteFeatureFlagResponseOne.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(deleteFeatureFlagResponseOne.response?.details).toBe(`Feature flag "${featureFlagName}" not found.`);

    // Providing the namespace should delete the feature flag successfully
    const deleteFeatureFlagResponseTwo = await client.deleteFeatureFlag({ featureFlagName, namespace });
    expect(deleteFeatureFlagResponseTwo.response?.code).toBe(EnumStatusCode.OK);

    // Attempting to delete the feature flag again should result in a not found error
    const deleteFeatureFlagResponseThree = await client.deleteFeatureFlag({ featureFlagName, namespace });
    expect(deleteFeatureFlagResponseThree.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(deleteFeatureFlagResponseThree.response?.details).toBe(`Feature flag "${featureFlagName}" not found.`);

    await server.close();
  });
});
