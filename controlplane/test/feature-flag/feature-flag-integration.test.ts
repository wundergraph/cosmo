import fs from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import { Label } from '../../src/types/index.js';
import { unsuccessfulBaseCompositionError } from '../../src/core/errors/errors.js';
import {
  assertExecutionConfigSubgraphNames,
  assertFeatureFlagExecutionConfig,
  assertNumberOfCompositions,
  createAndPublishSubgraph,
  createFeatureFlag,
  createFederatedGraph,
  createNamespace,
  createThenPublishFeatureSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_SUBGRAPH_URL_TWO,
  deleteFeatureFlag,
  featureFlagIntegrationTestSetUp,
  getDebugTestOptions,
  GraphNameAndKey,
  SetupTest,
  toggleFeatureFlag,
} from '../test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';

// Change to true to enable a longer timeout
const isDebugMode = false;
let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Feature flag integration tests', () => {
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

  test(
    'that a feature flag that is enabled upon creation can be disabled and re-enabled (default namespace with labels)',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels = [{ key: 'team', value: 'A' }];
      const baseGraphName = genID('baseFederatedGraphName');
      const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
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

      const featureFlagName = genID('flag');
      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], 'default', true);

      // The base recomposition and the feature flag composition
      await assertNumberOfCompositions(client, baseGraphName, 3);

      await assertFeatureFlagExecutionConfig(blobStorage, key, true);

      await toggleFeatureFlag(client, featureFlagName, false);

      // Another base recomposition to remove the feature flag
      await assertNumberOfCompositions(client, baseGraphName, 4);

      await assertFeatureFlagExecutionConfig(blobStorage, key, false);

      await toggleFeatureFlag(client, featureFlagName, true);

      // Another base recomposition and the feature flag composition
      await assertNumberOfCompositions(client, baseGraphName, 6);

      await assertFeatureFlagExecutionConfig(blobStorage, key, true);

      await server.close();
    },
  );

  test(
    'that a feature flag that is enabled upon creation can be disabled and re-enabled (namespace without labels)',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels: Array<Label> = [];
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const baseGraphName = genID('baseFederatedGraphName');
      const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
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

      const featureFlagName = genID('flag');
      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace, true);

      // The base recomposition and the feature flag composition
      await assertNumberOfCompositions(client, baseGraphName, 3, namespace);

      await assertFeatureFlagExecutionConfig(blobStorage, key, true);

      await toggleFeatureFlag(client, featureFlagName, false, namespace);

      // Another base recomposition to remove the feature flag
      await assertNumberOfCompositions(client, baseGraphName, 4, namespace);

      await assertFeatureFlagExecutionConfig(blobStorage, key, false);

      await toggleFeatureFlag(client, featureFlagName, true, namespace);

      // Another base recomposition and the feature flag composition
      await assertNumberOfCompositions(client, baseGraphName, 6, namespace);

      await assertFeatureFlagExecutionConfig(blobStorage, key, true);

      await server.close();
    },
  );

  test(
    'that a feature flag that is disabled upon creation can be enabled and re-disabled (namespace without labels)',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels: Array<Label> = [];
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const baseGraphName = genID('baseFederatedGraphName');
      const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
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

      const featureFlagName = genID('flag');
      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace);

      // The feature flag has not yet been enabled
      await assertNumberOfCompositions(client, baseGraphName, 1, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, key, false);

      // The feature flag is enabled and should trigger a base recomposition and the feature flag composition
      await toggleFeatureFlag(client, featureFlagName, true, namespace);
      await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, key, true);

      // The feature flag is disabled again and trigger a base recomposition
      await toggleFeatureFlag(client, featureFlagName, false, namespace);
      await assertNumberOfCompositions(client, baseGraphName, 4, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, key, false);

      await server.close();
    },
  );

  test(
    'that a feature flag that is enabled upon creation can be composed with contracts (namespace without labels)',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels: Array<Label> = [];
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const baseGraphName = genID('baseFederatedGraphName');
      const baseGraphResponse = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
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
      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace, true);

      // The base recomposition and the feature flag composition
      await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, true);

      // The contract recomposition and the feature flag composition
      await assertNumberOfCompositions(client, contractName, 3, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, contractKey, true);

      await server.close();
    },
  );

  test(
    'that a feature flag that is disabled upon creation can be composed with contracts (namespace without labels)',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels: Array<Label> = [];
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const baseGraphName = genID('baseFederatedGraphName');
      const baseGraphResponse = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
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
      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace);

      // No new compositions should have taken place
      await assertNumberOfCompositions(client, contractName, 1, namespace);
      await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

      // Enable the feature flag to trigger new compositions
      await toggleFeatureFlag(client, featureFlagName, true, namespace);

      // The base recomposition and the feature flag composition
      await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, true);

      // The contract recomposition and the feature flag composition
      await assertNumberOfCompositions(client, contractName, 3, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, contractKey, true);

      await server.close();
    },
  );

  test(
    'that publishing a feature subgraph that is not part of a feature flag does not trigger a composition',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels: Array<Label> = [];
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const baseGraphName = genID('baseFederatedGraphName');
      const baseGraphResponse = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: false },
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

      await createThenPublishFeatureSubgraph(
        client,
        'products-feature',
        'products',
        namespace,
        fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-feature.graphql`)).toString(),
        labels,
        'http://localhost:4102',
      );

      // Expect no further compositions
      await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

      await server.close();
    },
  );

  test(
    'that a failing base federated graph rejects a feature flag until it composes successfully',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels: Array<Label> = [];
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const baseGraphName = genID('baseFederatedGraphName');
      const baseGraphResponse = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
        ],
        baseGraphName,
        labels,
        namespace,
      );
      // Publish a schema to the products subgraph that is intentionally non-composable
      const publishSubgraphResponse = await client.publishFederatedSubgraph({
        name: 'products',
        namespace,
        schema: fs
          .readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-failing.graphql`))
          .toString(),
      });
      expect(publishSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

      expect(blobStorage.keys()).toHaveLength(1);
      const baseGraphKey = blobStorage.keys()[0];
      expect(baseGraphKey).toContain(baseGraphResponse.graph!.id);
      await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

      // The successful base composition and the failing base composition
      await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

      const featureFlagName = genID('flag');
      const createFeatureFlagResponse = await client.createFeatureFlag({
        name: featureFlagName,
        featureSubgraphNames: ['users-feature', 'products-feature'],
        labels,
        namespace,
        isEnabled: true,
      });
      expect(createFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
      expect(createFeatureFlagResponse.compositionErrors).toHaveLength(2);
      expect(createFeatureFlagResponse.compositionErrors[1]).toStrictEqual(
        unsuccessfulBaseCompositionError(baseGraphName, namespace),
      );

      // There will be a base recomposition, which will also fail, and the feature flag will be rejected
      await assertNumberOfCompositions(client, baseGraphName, 3, namespace);

      await createAndPublishSubgraph(
        client,
        'products',
        namespace,
        fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/products.graphql`)).toString(),
        labels,
        DEFAULT_SUBGRAPH_URL_TWO,
      );

      // Composition should now trigger for the base graph and then the feature flag
      await assertNumberOfCompositions(client, baseGraphName, 5, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, true);

      await server.close();
    },
  );

  test(
    'that a feature flag that is enabled upon creation can be deleted with contracts (namespace without labels)',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels: Array<Label> = [];
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const baseGraphName = genID('baseGraphName');
      const baseGraphResponse = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
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
      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace, true);

      // The base recomposition and the feature flag composition
      await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, true);

      // The contract recomposition and the feature flag composition
      await assertNumberOfCompositions(client, contractName, 3, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, contractKey, true);

      await deleteFeatureFlag(client, featureFlagName, namespace);

      // The base recomposition should remove the feature flag
      await assertNumberOfCompositions(client, baseGraphName, 4, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

      // The contract recomposition should remove the feature flag
      await assertNumberOfCompositions(client, contractName, 4, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, contractKey, false);

      // Attempting to delete the feature flag again should result in a not found error
      const deleteFeatureFlagResponse = await client.deleteFeatureFlag({ name: featureFlagName, namespace });
      expect(deleteFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(deleteFeatureFlagResponse.response?.details).toBe(`The feature flag "${featureFlagName}" was not found.`);

      await server.close();
    },
  );

  test(
    'that publishing a change to a subgraph produces new compositions for the base graph and contracts that also have feature flags',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels: Array<Label> = [];
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const baseGraphName = genID('baseGraphName');
      const baseGraphResponse = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
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
      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace, true);

      // There should be a base recomposition, a feature flag composition, and an embedded feature flag config
      for (const { name, key } of graphNamesAndKeys) {
        await assertNumberOfCompositions(client, name, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);
      }

      const publishResponse = await client.publishFederatedSubgraph({
        name: 'users',
        namespace,
        schema: fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users-update.graphql`)).toString(),
      });
      expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

      // There should be a base recomposition, feature flag composition, and the embedded feature flag config should remain
      for (const { name, key } of graphNamesAndKeys) {
        await assertNumberOfCompositions(client, name, 5, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);
      }

      await server.close();
    },
  );

  test(
    'test that multiple federated graphs and contracts compose and deploy correctly',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels: Array<Label> = [];
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const baseGraphNameOne = genID('baseGraphName');
      const baseGraphResponseOne = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
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
      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace, true);

      /* Each federated graph should have produced three total compositions:
       * 1. The original base composition
       * 2. The base recomposition
       * 3. The feature flag composition
       * Each config should contain an embedded a feature flag config
       * */
      for (const { name, key } of graphNamesAndKeys) {
        await assertNumberOfCompositions(client, name, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);
      }

      const publishResponse = await client.publishFederatedSubgraph({
        name: 'users',
        namespace,
        schema: fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users-update.graphql`)).toString(),
      });
      expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

      /* Each graph should have produced two new compositions: a base recomposition and the feature flag
       * The embedded feature flag config should remain
       * */
      for (const { name, key } of graphNamesAndKeys) {
        await assertNumberOfCompositions(client, name, 5, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);
      }

      await toggleFeatureFlag(client, featureFlagName, false, namespace);

      // Each graph should have one new base recomposition. The embedded feature flag config should also be removed
      for (const { name, key } of graphNamesAndKeys) {
        await assertNumberOfCompositions(client, name, 6, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);
      }

      await toggleFeatureFlag(client, featureFlagName, true, namespace);

      for (const { name, key } of graphNamesAndKeys) {
        await assertNumberOfCompositions(client, name, 8, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);
      }

      const deleteFeatureSubgraphResponse = await client.deleteFederatedSubgraph({
        subgraphName: 'products-feature',
        namespace,
      });
      expect(deleteFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

      // baseGraphOne recomposition and an attempted feature flag composition that fails
      await assertNumberOfCompositions(client, baseGraphNameOne, 10, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKeyOne, false);

      /* contractOne recomposition; however, the feature flag composition with the source graph fails, so there is no
       * feature flag composition for the contractOne.
       *  */
      await assertNumberOfCompositions(client, contractNameOne, 9, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, contractKeyOne, false);

      // baseGraphTwo recomposition and an attempted feature flag composition that fails
      await assertNumberOfCompositions(client, baseGraphNameTwo, 10, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKeyTwo, false);

      /* contractTwo recomposition; however, the feature flag composition with the source graph fails, so there is no
       * feature flag composition for contractTwo.
       *  */
      await assertNumberOfCompositions(client, contractNameTwo, 9, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, contractKeyTwo, false);

      await server.close();
    },
  );

  test(
    'that a feature subgraph is never included in the base composition',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels: Array<Label> = [];
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const baseGraphName = 'baseGraphName';
      const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
        ],
        baseGraphName,
        labels,
        namespace,
      );
      const subgraphIds = new Set<string>();
      for (const subgraphName of ['users', 'products']) {
        const getSubgraphByNameResponse = await client.getSubgraphByName({ name: subgraphName, namespace });
        expect(getSubgraphByNameResponse.response?.code).toBe(EnumStatusCode.OK);
        expect(getSubgraphByNameResponse.graph?.id).toBeDefined();
        subgraphIds.add(getSubgraphByNameResponse.graph!.id);
      }
      expect(blobStorage.keys()).toHaveLength(1);
      const key = blobStorage.keys()[0];
      expect(key).toContain(federatedGraphResponse.graph!.id);
      await assertExecutionConfigSubgraphNames(blobStorage, key, subgraphIds);

      await server.close();
    },
  );

  test(
    'that setting a feature flag to its current state does not trigger composition',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels = [{ key: 'team', value: 'A' }];
      const baseGraphName = 'baseGraphName';
      const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
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

      const featureFlagName = genID('flag');
      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], 'default', true);

      // The base recomposition and the feature flag composition
      await assertNumberOfCompositions(client, baseGraphName, 3);
      await assertFeatureFlagExecutionConfig(blobStorage, key, true);

      // The feature flag is already enabled, so this enable should do nothing
      await toggleFeatureFlag(client, featureFlagName, true);

      // Expect compositions to remain at 3
      await assertNumberOfCompositions(client, baseGraphName, 3);
      await assertFeatureFlagExecutionConfig(blobStorage, key, true);

      // Disable the feature flag
      await toggleFeatureFlag(client, featureFlagName, false);

      // Expect a base recomposition
      await assertNumberOfCompositions(client, baseGraphName, 4);
      await assertFeatureFlagExecutionConfig(blobStorage, key, false);

      // The feature flag is already disabled, so this disable should do nothing
      await toggleFeatureFlag(client, featureFlagName, false);

      // Expect compositions to remain at 4
      await assertNumberOfCompositions(client, baseGraphName, 4);
      await assertFeatureFlagExecutionConfig(blobStorage, key, false);

      await server.close();
    },
  );

  test('that feature subgraph publish recomposes the feature flag', async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

    const labels: Array<Label> = [];
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = 'baseGraphName';
    const baseGraphResponse = await featureFlagIntegrationTestSetUp(
      client,
      [
        { name: 'users', hasFeatureSubgraph: false },
        { name: 'products', hasFeatureSubgraph: false },
      ],
      baseGraphName,
      labels,
      namespace,
    );

    expect(blobStorage.keys()).toHaveLength(1);
    const baseGraphKey = blobStorage.keys()[0];
    expect(baseGraphKey).toContain(baseGraphResponse.graph!.id);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

    // The successful base composition
    await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

    await createThenPublishFeatureSubgraph(
      client,
      'users-feature',
      'users',
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users-feature.graphql`)).toString(),
      labels,
      'https://localhost:4003',
    );

    const featureFlagName = genID('flag');
    const createFeatureFlagResponse = await client.createFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: ['users-feature'],
      labels,
      namespace,
      isEnabled: true,
    });
    expect(createFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(createFeatureFlagResponse.compositionErrors).toHaveLength(2);

    // There will be a base recomposition and a feature flag composition, but the feature flag composition will fail
    await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

    await createThenPublishFeatureSubgraph(
      client,
      'products-feature',
      'products',
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-feature.graphql`)).toString(),
      labels,
      'https://localhost:4004',
    );

    /* The "products-feature" feature subgraph is not yet part of the feature flag,
     * so the number compositions should remain the same.
     * */
    await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      featureSubgraphNames: ['users-feature', 'products-feature'],
      name: featureFlagName,
      namespace,
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    // The base recomposition and the feature flag composition
    await assertNumberOfCompositions(client, baseGraphName, 5, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, true);

    const publishSubgraphResponse = await client.publishFederatedSubgraph({
      name: 'products-feature',
      namespace,
      schema: fs
        .readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-feature-update.graphql`))
        .toString(),
    });
    expect(publishSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Another base recomposition and a feature flag composition
    await assertNumberOfCompositions(client, baseGraphName, 7, namespace);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, true);

    await server.close();
  });

  test(
    'that a federated graph with feature flags and feature subgraphs can be moved',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels: Array<Label> = [];
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const newNamespace = genID('newnamespace').toLowerCase();
      await createNamespace(client, newNamespace);
      const baseGraphName = genID('baseFederatedGraphName');
      const featureFlagName = genID('flag');

      await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
        ],
        baseGraphName,
        labels,
        namespace,
      );

      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace, true);

      const moveFederatedGraphResponse = await client.moveFederatedGraph({
        name: baseGraphName,
        namespace,
        newNamespace,
      });
      expect(moveFederatedGraphResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
      expect(moveFederatedGraphResponse.compositionErrors).toHaveLength(2);
      expect(moveFederatedGraphResponse.compositionErrors[0].message).toBe(
        'At least one subgraph is required for federation.',
      );
      expect(moveFederatedGraphResponse.compositionErrors[1]).toStrictEqual(
        unsuccessfulBaseCompositionError(baseGraphName, namespace),
      );

      await server.close();
    },
  );

  test(
    'that a federated graph with a contract, feature flags, and feature subgraphs can be moved',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const labels: Array<Label> = [];
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const newNamespace = genID('newnamespace').toLowerCase();
      await createNamespace(client, newNamespace);
      const baseGraphName = genID('baseFederatedGraphName');
      const featureFlagName = genID('flag');

      await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
        ],
        baseGraphName,
        labels,
        namespace,
      );

      const contractName = genID('contract');
      const createContractResponse = await client.createContract({
        name: contractName,
        namespace,
        sourceGraphName: baseGraphName,
        excludeTags: ['exclude'],
        routingUrl: 'http://localhost:3003',
      });
      expect(createContractResponse.response?.code).toBe(EnumStatusCode.OK);

      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace, true);

      const moveFederatedGraphResponse = await client.moveFederatedGraph({
        name: baseGraphName,
        namespace,
        newNamespace,
      });
      expect(moveFederatedGraphResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
      expect(moveFederatedGraphResponse.compositionErrors).toHaveLength(2);
      expect(moveFederatedGraphResponse.compositionErrors[0].message).toBe(
        'At least one subgraph is required for federation.',
      );
      expect(moveFederatedGraphResponse.compositionErrors[1]).toStrictEqual(
        unsuccessfulBaseCompositionError(baseGraphName, namespace),
      );

      await server.close();
    },
  );

  test(
    'that a feature flag whose labels are updated recompose the correct federated graphs successfully',
    getDebugTestOptions(isDebugMode),
    async () => {
      const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

      const firstLabel = { key: 'team', value: 'A' };
      const secondLabel = { key: 'team', value: 'B' };
      const baseGraphNameOne = genID('baseFederatedGraphNameOne');
      const baseGraphNameTwo = genID('baseFederatedGraphNameTwo');
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const federatedGraphResponseOne = await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
        ],
        baseGraphNameOne,
        [firstLabel],
        namespace,
        [firstLabel, secondLabel],
      );
      expect(blobStorage.keys()).toHaveLength(1);
      const federatedGraphKeyOne = blobStorage.keys()[0];
      expect(federatedGraphKeyOne).toContain(federatedGraphResponseOne.graph!.id);
      await assertFeatureFlagExecutionConfig(blobStorage, federatedGraphKeyOne, false);

      // The base composition of graph one
      await assertNumberOfCompositions(client, baseGraphNameOne, 1, namespace);

      await createFederatedGraph(client, baseGraphNameTwo, namespace, ['team=B'], 'http://localhost:3003');
      const federatedGraphResponseTwo = await client.getFederatedGraphByName({
        name: baseGraphNameTwo,
        namespace,
      });

      expect(blobStorage.keys()).toHaveLength(2);
      const federatedGraphKeyTwo = blobStorage.keys()[1];
      expect(federatedGraphKeyTwo).toContain(federatedGraphResponseTwo.graph!.id);
      await assertFeatureFlagExecutionConfig(blobStorage, federatedGraphKeyTwo, false);

      // The base composition of graph two
      await assertNumberOfCompositions(client, baseGraphNameTwo, 1, namespace);

      const featureFlagName = genID('flag');
      await createFeatureFlag(
        client,
        featureFlagName,
        [firstLabel],
        ['users-feature', 'products-feature'],
        namespace,
        true,
      );

      // The base recomposition of graph one and the feature flag composition
      await assertNumberOfCompositions(client, baseGraphNameOne, 3, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, federatedGraphKeyOne, true);

      // The compositions of graph two should remain unchanged
      await assertNumberOfCompositions(client, baseGraphNameTwo, 1, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, federatedGraphKeyTwo, false);

      const updateFeatureFlagResponse = await client.updateFeatureFlag({
        name: featureFlagName,
        namespace,
        labels: [secondLabel],
      });
      expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

      // The base recomposition of graph one
      await assertNumberOfCompositions(client, baseGraphNameOne, 4, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, federatedGraphKeyOne, false);

      // The base recomposition of graph two and the feature flag composition
      await assertNumberOfCompositions(client, baseGraphNameTwo, 3, namespace);
      await assertFeatureFlagExecutionConfig(blobStorage, federatedGraphKeyTwo, true);

      await server.close();
    },
  );
});
