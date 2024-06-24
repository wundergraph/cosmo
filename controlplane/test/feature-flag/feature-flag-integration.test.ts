import fs from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import { Label } from '../../src/types/index.js';
import { featureFlagBaseGraphError } from '../../src/core/errors/errors.js';
import {
  assertFeatureFlagExecutionConfig,
  assertNumberOfCompositions,
  createAndPublishSubgraph,
  createFeatureFlag,
  createFederatedGraph,
  createNamespace,
  createThenPublishFeatureSubgraph,
  deleteFeatureFlag,
  featureFlagIntegrationTestSetUp,
  getDebugTestOptions,
  GraphNameAndKey,
  SetupTest,
  toggleFeatureFlag,
} from '../test-util.js';

// Change to true to enable a longer timeout
const isDebugMode = false;
let dbname = '';

describe('Feature flag integration tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature flag that is enabled upon creation can be disabled and re-enabled (default namespace with labels)', getDebugTestOptions(isDebugMode),  async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels = [{ key: 'team', value: 'A' }];
    const baseGraphName = 'baseGraphName'
    const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureSubgraph: true }, { name: 'products', hasFeatureSubgraph: true },
      ],
      baseGraphName,
      labels,
    );
    expect(blobStorage.keys()).toHaveLength(1);
    const key = blobStorage.keys()[0];
    expect(key).toContain(federatedGraphResponse.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, key, false);

    // The base composition
     await assertNumberOfCompositions(client, baseGraphName, 1);

    const featureFlagName = 'flag';
    await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], 'default', true);

    // The base composition and the feature flag composition
    await assertNumberOfCompositions(client, baseGraphName, 2);

    await assertFeatureFlagExecutionConfig(blobStorage, key, true);

    await toggleFeatureFlag(client, featureFlagName, false);

    // Another composition to remove the feature flag
    await assertNumberOfCompositions(client, baseGraphName, 3);

    await assertFeatureFlagExecutionConfig(blobStorage, key, false);

    await toggleFeatureFlag(client, featureFlagName, true);

    // Another composition to add the feature flag
    await assertNumberOfCompositions(client, baseGraphName, 4);

    await assertFeatureFlagExecutionConfig(blobStorage, key, true);

    await server.close();
  });

  test('that a feature flag that is enabled upon creation can be disabled and re-enabled (namespace without labels)', getDebugTestOptions(isDebugMode), async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels: Array<Label> = [];
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = 'baseGraphName'
    const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureSubgraph: true }, { name: 'products', hasFeatureSubgraph: true },
      ],
      baseGraphName,
      labels,
      namespace,
    );
    expect(blobStorage.keys()).toHaveLength(1);
    const key = blobStorage.keys()[0];
    expect(key).toContain(federatedGraphResponse.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, key, false);

    // The base composition
    await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

    const featureFlagName = 'flag';
    await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace, true);

    // The base composition and the feature flag composition
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

    await assertFeatureFlagExecutionConfig(blobStorage, key, true);

    await toggleFeatureFlag(client, featureFlagName, false, namespace);

    // Another composition to remove the feature flag
    await assertNumberOfCompositions(client, baseGraphName, 3, namespace);

    await assertFeatureFlagExecutionConfig(blobStorage, key, false);

    await toggleFeatureFlag(client, featureFlagName, true, namespace);

    // Another composition to add the feature flag
    await assertNumberOfCompositions(client, baseGraphName, 4, namespace);

    await assertFeatureFlagExecutionConfig(blobStorage, key, true);

    await server.close();
  });

  test('that a feature flag that is disabled upon creation can be enabled and re-disabled (namespace without labels)', getDebugTestOptions(isDebugMode), async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels: Array<Label> = [];
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = 'baseGraphName'
    const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureSubgraph: true }, { name: 'products', hasFeatureSubgraph: true },
      ],
      baseGraphName,
      labels,
      namespace,
    );
    expect(blobStorage.keys()).toHaveLength(1);
    const key = blobStorage.keys()[0];
    expect(key).toContain(federatedGraphResponse.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, key, false);

    // The base composition
    await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

    const featureFlagName = 'flag';
    await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace);

    // The feature flag has not yet been enabled
    await assertNumberOfCompositions(client, baseGraphName, 1, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, key, false);

    // The feature flag is enabled and should trigger the feature flag composition
    await toggleFeatureFlag(client, featureFlagName, true, namespace);
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, key, true);

    // The feature flag is disabled again and should recompose
    await toggleFeatureFlag(client, featureFlagName, false, namespace);
    await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, key, false);

    await server.close();
  });

  test('that a feature flag that is enabled upon creation can be composed with contracts (namespace without labels)', getDebugTestOptions(isDebugMode), async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels: Array<Label> = [];
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = 'federatedGraphName'
    const baseGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureSubgraph: true }, { name: 'products', hasFeatureSubgraph: true }
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
    await createFeatureFlag(
      client,
      featureFlagName,
      labels,
      ['users-feature', 'products-feature'],
      namespace,
      true,
    );

    // The base composition and the feature flag composition
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, true);

    // The contract composition and the feature flag composition
    await assertNumberOfCompositions(client, contractName, 2, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, contractKey, true);

    await server.close();
  });

  test('that a feature flag that is disabled upon creation can be composed with contracts (namespace without labels)', getDebugTestOptions(isDebugMode), async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels: Array<Label> = [];
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = 'federatedGraphName'
    const baseGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureSubgraph: true }, { name: 'products', hasFeatureSubgraph: true },
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

    // No new compositions should have taken place
    await assertNumberOfCompositions(client, contractName, 1, namespace);
    await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

    // Enable the feature flag to trigger new compositions
    await toggleFeatureFlag(client, featureFlagName, true, namespace);

    // The base composition and the feature flag composition
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, true);

    // The contract composition and the feature flag composition
    await assertNumberOfCompositions(client, contractName, 2, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, contractKey, true);

    await server.close();
  });

  test('that publishing a feature graph that is not part of a feature flag does not trigger a composition', getDebugTestOptions(isDebugMode), async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels: Array<Label> = [];
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = 'baseGraphName'
    const baseGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureSubgraph: true }, { name: 'products', hasFeatureSubgraph: false },
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

    await createThenPublishFeatureSubgraph(client,
      'products-feature',
      'products',
      namespace,
      fs.readFileSync(join(process.cwd(),`test/test-data/feature-flags/products-feature.graphql`)).toString(),
      labels,
      'http://localhost:4102',
    );

    // Expect no further compositions
    await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

    await server.close();
  });

  test('that a failing base federated graph rejects a feature flag until it composes successfully', getDebugTestOptions(isDebugMode), async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels: Array<Label> = [];
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = 'baseGraphName'
    const baseGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureSubgraph: true }, { name: 'products', hasFeatureSubgraph: true },
      ],
      baseGraphName,
      labels,
      namespace,
    );
    // Publish a schema to the products subgraph that is intentionally non-composable
    const publishSubgraphResponse = await client.publishFederatedSubgraph({
      name: 'products',
      namespace,
      schema: fs.readFileSync(join(process.cwd(),`test/test-data/feature-flags/products-failing.graphql`)).toString(),
    });
    expect(publishSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

    expect(blobStorage.keys()).toHaveLength(1);
    const baseGraphKey = blobStorage.keys()[0];
    expect(baseGraphKey).toContain(baseGraphResponse.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

    // The successful base composition and the failing base composition
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

    const featureFlagName = 'flag';
    const createFeatureFlagResponse = await client.createFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: ['users-feature', 'products-feature'],
      labels,
      namespace,
      isEnabled: true,
    });
    expect(createFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(createFeatureFlagResponse.compositionErrors).toHaveLength(1);
    expect(createFeatureFlagResponse.compositionErrors[0])
      .toStrictEqual(featureFlagBaseGraphError(baseGraphName, featureFlagName, namespace));

    // The number of compositions should remain the same because the feature flag was rejected
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

    await createAndPublishSubgraph(
      client,
      'products',
      namespace,
      fs.readFileSync(join(process.cwd(),`test/test-data/feature-flags/products.graphql`)).toString(),
      labels,
      'http://localhost:4002',
    );

    // Composition should now trigger for the base graph and then the feature flag
    await assertNumberOfCompositions(client, baseGraphName, 4, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, true);

    await server.close();
  });

  test('that a feature flag that is enabled upon creation can be deleted with contracts (namespace without labels)', getDebugTestOptions(isDebugMode), async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels: Array<Label> = [];
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = genID('baseGraphName');
    const baseGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureSubgraph: true }, { name: 'products', hasFeatureSubgraph: true }
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

    const featureFlagName = genID('flag');
    await createFeatureFlag(
      client,
      featureFlagName,
      labels,
      ['users-feature', 'products-feature'],
      namespace,
      true,
    );

    // The base composition and the feature flag composition
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, true);

    // The contract composition and the feature flag composition
    await assertNumberOfCompositions(client, contractName, 2, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, contractKey, true);

    await deleteFeatureFlag(client, featureFlagName, namespace);

    // The base composition should remove the feature flag
    await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

    // The contract composition should remove the feature flag
    await assertNumberOfCompositions(client, contractName, 3, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, contractKey, false);

    // Attempting to delete the feature flag again should result in a not found error
    const deleteFeatureFlagResponse = await client.deleteFeatureFlag({ name: featureFlagName, namespace });
    expect(deleteFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(deleteFeatureFlagResponse.response?.details).toBe(`The feature flag "${featureFlagName}" was not found.`);

    await server.close();
  });

  test('that publishing a change to a subgraph produces new compositions for the base graph and contracts that also have feature flags', getDebugTestOptions(isDebugMode), async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels: Array<Label> = [];
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = genID('baseGraphName');
    const baseGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureSubgraph: true }, { name: 'products', hasFeatureSubgraph: true }
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

    expect(blobStorage.keys()).toHaveLength(2);
    const contractKey = blobStorage.keys()[1];
    const contractResponse = await client.getFederatedGraphByName({
      name: contractName,
      namespace,
    });
    expect(contractResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(contractKey).toContain(contractResponse.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, contractKey, false);

    const graphNamesAndKeys: Array<GraphNameAndKey> = [
      { name: baseGraphName, key: baseGraphKey },
      { name: contractName, key: contractKey },
    ];

    // Both graphs should still be at a single composition with feature flag config
    for (const { name, key } of graphNamesAndKeys) {
      await assertNumberOfCompositions(client, name, 1, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, key, false);
    }

    const featureFlagName = genID('flag');
    await createFeatureFlag(
      client,
      featureFlagName,
      labels,
      ['users-feature', 'products-feature'],
      namespace,
      true,
    );

    // The feature flag composition should be added, and the config should contain a feature flag config
    for (const { name, key } of graphNamesAndKeys) {
      await assertNumberOfCompositions(client, name, 2, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, key, true);
    }

    const publishResponse = await client.publishFederatedSubgraph({
      name: 'users',
      namespace,
      schema: fs.readFileSync(join(process.cwd(),`test/test-data/feature-flags/users-update.graphql`)).toString(),
    });
    expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

    // There should be a new base composition, feature flag composition, and the feature flag config should remain
    for (const { name, key } of graphNamesAndKeys) {
      await assertNumberOfCompositions(client, name, 4, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, key, true);
    }

    await server.close();
  });

  test('test that multiple federated graphs and contracts compose and deploy correctly', getDebugTestOptions(isDebugMode), async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const labels: Array<Label> = [];
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphNameOne = genID('baseGraphName');
    const baseGraphResponseOne = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureSubgraph: true }, { name: 'products', hasFeatureSubgraph: true }
      ],
      baseGraphNameOne,
      labels,
      namespace,
    );
    expect(blobStorage.keys()).toHaveLength(1);
    const baseGraphKeyOne = blobStorage.keys()[0];
    expect(baseGraphKeyOne).toContain(baseGraphResponseOne.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKeyOne, false);

    // Base graph one composition
    await assertNumberOfCompositions(client, baseGraphNameOne, 1, namespace);

    const contractNameOne = genID('contractOne');
    const createContractResponseOne = await client.createContract({
      name: contractNameOne,
      namespace,
      sourceGraphName: baseGraphNameOne,
      excludeTags: ['exclude'],
      routingUrl: 'http://localhost:3003',
    });
    expect(createContractResponseOne.response?.code).toBe(EnumStatusCode.OK);

    // Base graph one contract composition
    await assertNumberOfCompositions(client, contractNameOne, 1, namespace);

    // Base graph one compositions should remain at one
    await assertNumberOfCompositions(client, baseGraphNameOne, 1, namespace);

    expect(blobStorage.keys()).toHaveLength(2);
    const contractKeyOne = blobStorage.keys()[1];
    const contractResponseOne = await client.getFederatedGraphByName({
      name: contractNameOne,
      namespace,
    });
    expect(contractResponseOne.response?.code).toBe(EnumStatusCode.OK);
    expect(contractKeyOne).toContain(contractResponseOne.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, contractKeyOne, false);

    const baseGraphNameTwo = genID('baseGraphNameTwo');
    await createFederatedGraph(client, baseGraphNameTwo, namespace, [], 'http://localhost:3003');
    const baseGraphResponseTwo = await client.getFederatedGraphByName({
      name: baseGraphNameTwo,
      namespace,
    });

    // Base graph two composition
    await assertNumberOfCompositions(client, baseGraphNameTwo, 1, namespace);

    expect(blobStorage.keys()).toHaveLength(3);
    const baseGraphKeyTwo = blobStorage.keys()[2];
    expect(baseGraphKeyTwo).toContain(baseGraphResponseTwo.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKeyTwo, false);

    const contractNameTwo = genID('contractTwo');
    const createContractResponseTwo = await client.createContract({
      name: contractNameTwo,
      namespace,
      sourceGraphName: baseGraphNameTwo,
      excludeTags: ['exclude'],
      routingUrl: 'http://localhost:3004',
    });
    expect(createContractResponseTwo.response?.code).toBe(EnumStatusCode.OK);

    expect(blobStorage.keys()).toHaveLength(4);
    const contractKeyTwo = blobStorage.keys()[3];
    const contractResponseTwo = await client.getFederatedGraphByName({
      name: contractNameTwo,
      namespace,
    });
    expect(contractResponseTwo.response?.code).toBe(EnumStatusCode.OK);
    expect(contractKeyTwo).toContain(contractResponseTwo.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, contractKeyTwo, false);

    const graphNamesAndKeys: Array<GraphNameAndKey> = [
      { name: baseGraphNameOne, key: baseGraphKeyOne },
      { name: contractNameOne, key: contractKeyOne },
      { name: baseGraphNameTwo, key: baseGraphKeyTwo },
      { name: contractNameTwo, key: contractKeyTwo },
    ];

    // All graphs should still be at a single composition without feature flag configs
    for (const { name, key } of graphNamesAndKeys) {
      await assertNumberOfCompositions(client, name, 1, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, key, false);
    }

    const featureFlagName = genID('flag');
    await createFeatureFlag(
      client,
      featureFlagName,
      labels,
      ['users-feature', 'products-feature'],
      namespace,
      true,
    );

    /* Each graph should have produced two total compositions: the original base and the feature flag
     * Each config should feature a feature flag config
     * */
    for (const { name, key } of graphNamesAndKeys) {
      await assertNumberOfCompositions(client, name, 2, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, key, true);
    }

    const publishResponse = await client.publishFederatedSubgraph({
      name: 'users',
      namespace,
      schema: fs.readFileSync(join(process.cwd(),`test/test-data/feature-flags/users-update.graphql`)).toString(),
    });
    expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

    /* Each graph should have produced two new compositions: a base recomposition and the feature flag
     * The feature flag config should remain
     * */
    for (const { name, key } of graphNamesAndKeys) {
      await assertNumberOfCompositions(client, name, 4, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, key, true);
    }

    await toggleFeatureFlag(client, featureFlagName, false, namespace);

    /* Each graph should have two new compositions: a base recomposition and the feature flag
     * The feature flag config should also be removed
     * */
    for (const { name, key } of graphNamesAndKeys) {
      await assertNumberOfCompositions(client, name, 5, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, key, false);
    }

    await server.close();
  });
});
