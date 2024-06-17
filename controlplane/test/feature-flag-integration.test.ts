import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { Label } from '../src/types/index.js';
import {
  assertFeatureFlagExecutionConfig,
  assertNumberOfCompositions,
  createFeatureFlag,
  createNamespace, getDebugTestOptions,
  toggleFeatureFlag,
  featureFlagIntegrationTestSetUp,
  SetupTest,
} from './test-util.js';

const isDebugMode = true;
let dbname = '';

describe('Feature flag integration tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature flag can be disabled and re-enabled (default namespace with labels)', getDebugTestOptions(isDebugMode),  async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels = [{ key: 'team', value: 'A' }];
    const federatedGraphName = 'federatedGraphName'
    const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureGraph: true }, { name: 'products', hasFeatureGraph: true }
      ],
      federatedGraphName,
      labels,
    );
    expect(blobStorage.keys()).toHaveLength(1);
    const key = blobStorage.keys()[0];
    expect(key).toContain(federatedGraphResponse.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, key, false);

    // The base composition
     await assertNumberOfCompositions(client, federatedGraphName, 1);

    const featureFlagName = 'flag';
    await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature']);

    // The base composition and the feature flag composition
    await assertNumberOfCompositions(client, federatedGraphName, 2);

    await assertFeatureFlagExecutionConfig(blobStorage, key, true);

    await toggleFeatureFlag(client, featureFlagName, false);

    // Another composition to remove the feature flag
    await assertNumberOfCompositions(client, federatedGraphName, 3);

    await assertFeatureFlagExecutionConfig(blobStorage, key, false);

    await toggleFeatureFlag(client, featureFlagName, true);

    // Another composition to add the feature flag
    await assertNumberOfCompositions(client, federatedGraphName, 4);

    await assertFeatureFlagExecutionConfig(blobStorage, key, true);

    await server.close();
  });

  test('that a feature flag can be disabled and re-enabled (namespace without labels)', getDebugTestOptions(isDebugMode), async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels: Array<Label> = [];
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const federatedGraphName = 'federatedGraphName'
    const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureGraph: true }, { name: 'products', hasFeatureGraph: true }
      ],
      federatedGraphName,
      labels,
      namespace,
    );
    expect(blobStorage.keys()).toHaveLength(1);
    const key = blobStorage.keys()[0];
    expect(key).toContain(federatedGraphResponse.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, key, false);

    // The base composition
    await assertNumberOfCompositions(client, federatedGraphName, 1, namespace);

    const featureFlagName = 'flag';
    await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace);

    // The base composition and the feature flag composition
    await assertNumberOfCompositions(client, federatedGraphName, 2, namespace);

    await assertFeatureFlagExecutionConfig(blobStorage, key, true);

    await toggleFeatureFlag(client, featureFlagName, false, namespace);

    // Another composition to remove the feature flag
    await assertNumberOfCompositions(client, federatedGraphName, 3, namespace);

    await assertFeatureFlagExecutionConfig(blobStorage, key, false);

    await toggleFeatureFlag(client, featureFlagName, true, namespace);

    // Another composition to add the feature flag
    await assertNumberOfCompositions(client, federatedGraphName, 4, namespace);

    await assertFeatureFlagExecutionConfig(blobStorage, key, true);

    await server.close();
  });

  test('that a feature flag and contracts something something todo', getDebugTestOptions(isDebugMode), async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels: Array<Label> = [];
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = 'federatedGraphName'
    const baseGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureGraph: true }, { name: 'products', hasFeatureGraph: true }
      ],
      baseGraphName,
      labels,
      namespace,
    );
    expect(blobStorage.keys()).toHaveLength(1);
    const baseGraphKey = blobStorage.keys()[0];
    expect(baseGraphKey).toContain(baseGraphResponse.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

    // The base composition
    await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

    const contractName = genID('contract');
    const createContractResponse = await client.createContract({
      name: contractName,
      namespace,
      sourceGraphName: baseGraphName,
      excludeTags: ['exclude'],
      routingUrl: 'http://localhost:3003',
    });
    expect(createContractResponse.response?.code).toBe(EnumStatusCode.OK);

    // The contract composition
    await assertNumberOfCompositions(client, contractName, 1, namespace);

    // The base composition should remain at one
    await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

    expect(blobStorage.keys()).toHaveLength(2);
    const contractKey = blobStorage.keys()[1];
    const contractResponse = await client.getFederatedGraphByName({
      name: contractName,
      namespace,
    });
    expect(contractResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(contractKey).toContain(contractResponse.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, contractKey, false);

    const featureFlagName = 'flag';
    await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace);

    // The base composition and the feature flag composition
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, true);

    // The contract composition and the feature flag composition
    // TODO investigate the number of compositions
    await assertNumberOfCompositions(client, contractName, 3, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, contractKey, true);

    await server.close();
  });
});
