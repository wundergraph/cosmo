import fs from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { eq } from 'drizzle-orm';
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
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_THREE,
  DEFAULT_SUBGRAPH_URL_TWO,
  deleteFeatureFlag,
  featureFlagIntegrationTestSetUp,
  getDebugTestOptions,
  GraphNameAndKey,
  SetupTest,
  toggleFeatureFlag,
} from '../test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { graphCompositions } from '../../src/db/schema.js';

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

  describe('Legacy tests', () => {
    test(
      'that a feature flag that is enabled upon creation can be disabled and re-enabled (default namespace with labels)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels = [
          {
            key: 'team',
            value: 'A',
          },
        ];
        const baseGraphName = genID('baseFederatedGraphName');
        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
          ],
          baseGraphName,
          labels,
        );
        expect(blobStorage.keys()).toHaveLength(1);
        const key = blobStorage.keys()[0];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1);

        const featureFlagName = genID('flag');
        await createFeatureFlag(
          client,
          featureFlagName,
          labels,
          ['users-feature', 'products-feature'],
          'default',
          true,
        );

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
      },
    );

    test(
      'that a feature flag that is enabled upon creation can be disabled and re-enabled (namespace without labels)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels: Array<Label> = [];
        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);
        const baseGraphName = genID('baseFederatedGraphName');
        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
          ],
          baseGraphName,
          labels,
          namespace,
        );
        expect(blobStorage.keys()).toHaveLength(1);
        const key = blobStorage.keys()[0];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(
          client,
          featureFlagName,
          labels,
          ['users-feature', 'products-feature'],
          namespace,
          true,
        );

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
      },
    );

    test(
      'that a feature flag that is disabled upon creation can be enabled and re-disabled (namespace without labels)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels: Array<Label> = [];
        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);
        const baseGraphName = genID('baseFederatedGraphName');
        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
          ],
          baseGraphName,
          labels,
          namespace,
        );
        expect(blobStorage.keys()).toHaveLength(1);
        const key = blobStorage.keys()[0];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);
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
      },
    );

    test(
      'that a feature flag that is enabled upon creation can be composed with contracts (namespace without labels)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels: Array<Label> = [];
        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);
        const baseGraphName = genID('baseFederatedGraphName');
        const baseGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
          ],
          baseGraphName,
          labels,
          namespace,
        );
        expect(blobStorage.keys()).toHaveLength(1);
        const baseGraphKey = blobStorage.keys()[0];
        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/routerconfigs/latest.json`);
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
        expect(contractKey).toContain(`${contractResponse.graph!.id}/routerconfigs/latest.json`);
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

        // The base recomposition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, true);

        // The contract recomposition and the feature flag composition
        await assertNumberOfCompositions(client, contractName, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, contractKey, true);
      },
    );

    test(
      'that a feature flag that is disabled upon creation can be composed with contracts (namespace without labels)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels: Array<Label> = [];
        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);
        const baseGraphName = genID('baseFederatedGraphName');
        const baseGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
          ],
          baseGraphName,
          labels,
          namespace,
        );
        expect(blobStorage.keys()).toHaveLength(1);
        const baseGraphKey = blobStorage.keys()[0];
        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/routerconfigs/latest.json`);
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
        expect(contractKey).toContain(`${contractResponse.graph!.id}/routerconfigs/latest.json`);
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
      },
    );

    test(
      'that publishing a feature subgraph that is not part of a feature flag does not trigger a composition',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels: Array<Label> = [];
        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);
        const baseGraphName = genID('baseFederatedGraphName');
        const baseGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: false,
            },
          ],
          baseGraphName,
          labels,
          namespace,
        );
        expect(blobStorage.keys()).toHaveLength(1);
        const baseGraphKey = blobStorage.keys()[0];
        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/routerconfigs/latest.json`);
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
      },
    );

    test(
      'that a failing base federated graph rejects a feature flag until it composes successfully',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels: Array<Label> = [];
        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);
        const baseGraphName = genID('baseFederatedGraphName');
        const baseGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
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
        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/routerconfigs/latest.json`);
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
      },
    );

    test(
      'that a feature flag that is enabled upon creation can be deleted with contracts (namespace without labels)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels: Array<Label> = [];
        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);
        const baseGraphName = genID('baseGraphName');
        const baseGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
          ],
          baseGraphName,
          labels,
          namespace,
        );
        expect(blobStorage.keys()).toHaveLength(1);
        const baseGraphKey = blobStorage.keys()[0];
        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/routerconfigs/latest.json`);
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
        expect(contractKey).toContain(`${contractResponse.graph!.id}/routerconfigs/latest.json`);
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
        const deleteFeatureFlagResponse = await client.deleteFeatureFlag({
          name: featureFlagName,
          namespace,
        });
        expect(deleteFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
        expect(deleteFeatureFlagResponse.response?.details).toBe(
          `The feature flag "${featureFlagName}" was not found.`,
        );
      },
    );

    test(
      'that publishing a change to a subgraph produces new compositions for the base graph and contracts that also have feature flags',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels: Array<Label> = [];
        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);
        const baseGraphName = genID('baseGraphName');
        const baseGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
          ],
          baseGraphName,
          labels,
          namespace,
        );
        expect(blobStorage.keys()).toHaveLength(1);
        const baseGraphKey = blobStorage.keys()[0];
        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/routerconfigs/latest.json`);
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
        expect(contractKey).toContain(`${contractResponse.graph!.id}/routerconfigs/latest.json`);
        await assertFeatureFlagExecutionConfig(blobStorage, contractKey, false);

        const graphNamesAndKeys: Array<GraphNameAndKey> = [
          {
            name: baseGraphName,
            key: baseGraphKey,
          },
          {
            name: contractName,
            key: contractKey,
          },
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
      },
    );

    test(
      'test that multiple federated graphs and contracts compose and deploy correctly',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels: Array<Label> = [];
        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);
        const baseGraphNameOne = genID('baseGraphName');
        const baseGraphResponseOne = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
          ],
          baseGraphNameOne,
          labels,
          namespace,
        );
        expect(blobStorage.keys()).toHaveLength(1);
        const baseGraphKeyOne = blobStorage.keys()[0];
        expect(baseGraphKeyOne).toContain(`${baseGraphResponseOne.graph!.id}/routerconfigs/latest.json`);
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
        expect(contractKeyOne).toContain(`${contractResponseOne.graph!.id}/routerconfigs/latest.json`);
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
        expect(baseGraphKeyTwo).toContain(`${baseGraphResponseTwo.graph!.id}/routerconfigs/latest.json`);
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
        expect(contractKeyTwo).toContain(`${contractResponseTwo.graph!.id}/routerconfigs/latest.json`);
        await assertFeatureFlagExecutionConfig(blobStorage, contractKeyTwo, false);

        const graphNamesAndKeys: Array<GraphNameAndKey> = [
          {
            name: baseGraphNameOne,
            key: baseGraphKeyOne,
          },
          {
            name: contractNameOne,
            key: contractKeyOne,
          },
          {
            name: baseGraphNameTwo,
            key: baseGraphKeyTwo,
          },
          {
            name: contractNameTwo,
            key: contractKeyTwo,
          },
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
      },
    );

    test(
      'that a feature subgraph is never included in the base composition',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels: Array<Label> = [];
        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);
        const baseGraphName = 'baseGraphName';
        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
          ],
          baseGraphName,
          labels,
          namespace,
        );
        const subgraphIds = new Set<string>();
        for (const subgraphName of ['users', 'products']) {
          const getSubgraphByNameResponse = await client.getSubgraphByName({
            name: subgraphName,
            namespace,
          });
          expect(getSubgraphByNameResponse.response?.code).toBe(EnumStatusCode.OK);
          expect(getSubgraphByNameResponse.graph?.id).toBeDefined();
          subgraphIds.add(getSubgraphByNameResponse.graph!.id);
        }
        expect(blobStorage.keys()).toHaveLength(1);
        const key = blobStorage.keys()[0];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);
        await assertExecutionConfigSubgraphNames(blobStorage, key, subgraphIds);
      },
    );

    test(
      'that setting a feature flag to its current state does not trigger composition',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels = [
          {
            key: 'team',
            value: 'A',
          },
        ];
        const baseGraphName = 'baseGraphName';
        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
          ],
          baseGraphName,
          labels,
        );
        expect(blobStorage.keys()).toHaveLength(1);
        const key = blobStorage.keys()[0];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1);

        const featureFlagName = genID('flag');
        await createFeatureFlag(
          client,
          featureFlagName,
          labels,
          ['users-feature', 'products-feature'],
          'default',
          true,
        );

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
      },
    );

    test(
      'that feature subgraph publish recomposes the feature flag',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const labels: Array<Label> = [];
        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);
        const baseGraphName = 'baseGraphName';
        const baseGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: false,
            },
            {
              name: 'products',
              hasFeatureSubgraph: false,
            },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(1);
        const baseGraphKey = blobStorage.keys()[0];
        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/routerconfigs/latest.json`);
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
      },
    );

    test(
      'that a federated graph with feature flags and feature subgraphs can be moved',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

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
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        await createFeatureFlag(
          client,
          featureFlagName,
          labels,
          ['users-feature', 'products-feature'],
          namespace,
          true,
        );

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
          unsuccessfulBaseCompositionError(baseGraphName, newNamespace),
        );

        /**
         * The federated graph is moved without its subgraphs.
         * Subgraphs that form the base of feature subgraphs cannot be moved
         */
        const fedGraphByNameResp = await client.getFederatedGraphByName({
          name: baseGraphName,
          namespace: newNamespace,
        });
        expect(fedGraphByNameResp.response?.code).toBe(EnumStatusCode.OK);

        // The feature flag cannot be moved because the feature subgraphs cannot be moved
        const featureFlagByNameResp = await client.getFeatureFlagByName({
          name: featureFlagName,
          namespace: newNamespace,
        });
        expect(featureFlagByNameResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      },
    );

    test(
      'that a federated graph with a contract, feature flags, and feature subgraphs can be moved',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

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
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
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

        await createFeatureFlag(
          client,
          featureFlagName,
          labels,
          ['users-feature', 'products-feature'],
          namespace,
          true,
        );

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
          unsuccessfulBaseCompositionError(baseGraphName, newNamespace),
        );

        /**
         * The federated graph is moved without its subgraphs.
         * Subgraphs that form the base of feature subgraphs cannot be moved
         */
        const fedGraphByNameResp = await client.getFederatedGraphByName({
          name: baseGraphName,
          namespace: newNamespace,
        });
        expect(fedGraphByNameResp.response?.code).toBe(EnumStatusCode.OK);

        const contractResp = await client.getFederatedGraphByName({
          name: contractName,
          namespace: newNamespace,
        });
        expect(contractResp.response?.code).toBe(EnumStatusCode.OK);

        // The feature flag cannot be moved because the feature subgraphs cannot be moved
        const featureFlagByNameResp = await client.getFeatureFlagByName({
          name: featureFlagName,
          namespace: newNamespace,
        });
        expect(featureFlagByNameResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      },
    );

    test(
      'that a feature flag whose labels are updated recompose the correct federated graphs successfully',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const firstLabel = {
          key: 'team',
          value: 'A',
        };
        const secondLabel = {
          key: 'team',
          value: 'B',
        };
        const baseGraphNameOne = genID('baseFederatedGraphNameOne');
        const baseGraphNameTwo = genID('baseFederatedGraphNameTwo');
        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);
        const federatedGraphResponseOne = await featureFlagIntegrationTestSetUp(
          client,
          [
            {
              name: 'users',
              hasFeatureSubgraph: true,
            },
            {
              name: 'products',
              hasFeatureSubgraph: true,
            },
          ],
          baseGraphNameOne,
          [firstLabel],
          namespace,
          [firstLabel, secondLabel],
        );
        expect(blobStorage.keys()).toHaveLength(1);
        const federatedGraphKeyOne = blobStorage.keys()[0];
        expect(federatedGraphKeyOne).toContain(`${federatedGraphResponseOne.graph!.id}/routerconfigs/latest.json`);
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
        expect(federatedGraphKeyTwo).toContain(`${federatedGraphResponseTwo.graph!.id}/routerconfigs/latest.json`);
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
      },
    );

    test(
      'that when a subgraph label changes, all affected graphs and feature flags are recomposed',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        const labels = [{ key: 'team', value: 'A' }];
        const baseGraphName = genID('baseFederatedGraphName');

        await createNamespace(client, namespace);

        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: true },
            { name: 'products-standalone', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(1);
        const key = blobStorage.keys()[0];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(1);

        // The base recomposition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);

        // Update the labels of the subgraph
        let updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          labels: [{ key: 'team', value: 'B' }],
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // The base graph and feature flag should have recomposed
        await assertNumberOfCompositions(client, baseGraphName, 5, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);

        // Update the labels of the subgraph
        updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          labels: [{ key: 'team', value: 'A' }],
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // The base graph and feature flag should have recomposed
        await assertNumberOfCompositions(client, baseGraphName, 7, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);
      },
    );

    test(
      'that setting new labels that do not affect existing label matchers does not produce unnecessary recompositions',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        const labels = [{ key: 'team', value: 'A' }];
        const baseGraphName = genID('baseFederatedGraphName');

        await createNamespace(client, namespace);

        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: true },
            { name: 'products-standalone', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(1);
        const key = blobStorage.keys()[0];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(1);

        // The base recomposition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);

        // Update the labels of the subgraph
        const updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          labels: [
            { key: 'team', value: 'B' },
            { key: 'team', value: 'A' },
          ],
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // There should not be any new recomposition
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);
      },
    );

    test(
      'that changing the routing url triggers a recomposition when label matchers do not change',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        const labels = [{ key: 'team', value: 'A' }];
        const baseGraphName = genID('baseFederatedGraphName');

        await createNamespace(client, namespace);

        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: true },
            { name: 'products-standalone', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(1);
        const key = blobStorage.keys()[0];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(1);

        // The base recomposition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);

        // Update the labels of the subgraph
        const updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          labels: [
            { key: 'team', value: 'B' },
            { key: 'team', value: 'A' },
          ],
          routingUrl: DEFAULT_SUBGRAPH_URL_THREE,
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // There should be a recomposition for the federated graph and feature flag
        await assertNumberOfCompositions(client, baseGraphName, 5, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);
      },
    );

    test(
      'that changing the routing url and the labels of a mutual subgraph trigger composition',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        const labels = [{ key: 'team', value: 'A' }];
        const baseGraphName = genID('baseFederatedGraphName');

        await createNamespace(client, namespace);

        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: true },
            { name: 'products-standalone', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(1);
        const key = blobStorage.keys()[0];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(1);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);

        // Update the labels of the subgraph
        const updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          labels: [{ key: 'team', value: 'B' }],
          routingUrl: DEFAULT_SUBGRAPH_URL_THREE,
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // There should be a recomposition for the federated graph and feature flag
        await assertNumberOfCompositions(client, baseGraphName, 5, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);
      },
    );

    test(
      'that unsetting empty labels does not trigger composition',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        const labels: Label[] = [];
        const baseGraphName = genID('baseFederatedGraphName');

        await createNamespace(client, namespace);

        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: true },
            { name: 'products-standalone', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(1);
        const key = blobStorage.keys()[0];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(1);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);

        // Update the labels of the subgraph
        const updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          unsetLabels: true,
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // There should be a recomposition for the federated graph and feature flag
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);
      },
    );

    test(
      'that unsetting non-empty labels triggers composition',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        const labels: Label[] = [{ key: 'team', value: 'A' }];
        const baseGraphName = genID('baseFederatedGraphName');

        await createNamespace(client, namespace);

        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: true },
            { name: 'products-standalone', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(1);
        const key = blobStorage.keys()[0];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(1);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);

        // Update the labels of the subgraph
        const updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          unsetLabels: true,
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // There should be a recomposition for the federated graph and feature flag
        await assertNumberOfCompositions(client, baseGraphName, 5, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, true);
      },
    );
  });

  describe('`split-config-loading` flag enabled tests', () => {
    test(
      'that a feature flag that is enabled upon creation can be disabled and re-enabled (default namespace with labels)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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

        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1);

        const featureFlagName = genID('flag');
        await createFeatureFlag(
          client,
          featureFlagName,
          labels,
          ['users-feature', 'products-feature'],
          'default',
          true,
        );

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);
        await toggleFeatureFlag(client, featureFlagName, false);

        expect(blobStorage.keys()).toHaveLength(2);

        // The feature flag is removed without further compositions
        await assertNumberOfCompositions(client, baseGraphName, 2);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);
        await toggleFeatureFlag(client, featureFlagName, true);

        // The feature flag is composed again
        await assertNumberOfCompositions(client, baseGraphName, 3);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        expect(blobStorage.keys()).toHaveLength(3);
      },
    );

    test(
      'that a feature flag that is enabled upon creation can be disabled and re-enabled (namespace without labels)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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

        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];

        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(
          client,
          featureFlagName,
          labels,
          ['users-feature', 'products-feature'],
          namespace,
          true,
        );

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);
        await toggleFeatureFlag(client, featureFlagName, false, namespace);

        expect(blobStorage.keys()).toHaveLength(2);

        // The feature flag is removed without further compositions
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);
        await toggleFeatureFlag(client, featureFlagName, true, namespace);

        // The feature flag is composed again
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        expect(blobStorage.keys()).toHaveLength(3);
      },
    );

    test(
      'that a feature flag that is disabled upon creation can be enabled and re-disabled (namespace without labels)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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
        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];

        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace);

        expect(blobStorage.keys()).toHaveLength(2);

        // The feature flag has not yet been enabled
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The feature flag is enabled and should trigger a base recomposition and the feature flag composition
        await toggleFeatureFlag(client, featureFlagName, true, namespace);
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The feature flag is disabled again but the base is not recomposed
        await toggleFeatureFlag(client, featureFlagName, false, namespace);
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        expect(blobStorage.keys()).toHaveLength(2);
      },
    );

    test(
      'that a feature flag that is enabled upon creation can be composed with contracts (namespace without labels)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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

        expect(blobStorage.keys()).toHaveLength(2);
        const baseGraphKey = blobStorage.keys()[0];
        const baseGraphMapperKey = blobStorage.keys()[1];

        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/manifest/latest.json`);
        expect(baseGraphMapperKey).toContain(`${baseGraphResponse.graph!.id}/manifest/mapper.json`);
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

        expect(blobStorage.keys()).toHaveLength(4);
        const contractKey = blobStorage.keys()[2];
        const contractMapperKey = blobStorage.keys()[3];

        const contractResponse = await client.getFederatedGraphByName({
          name: contractName,
          namespace,
        });

        expect(contractResponse.response?.code).toBe(EnumStatusCode.OK);
        expect(contractKey).toContain(`${contractResponse.graph!.id}/manifest/latest.json`);
        expect(contractMapperKey).toContain(`${contractResponse.graph!.id}/manifest/mapper.json`);
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

        const blobKeys = blobStorage.keys();
        expect(blobKeys).toHaveLength(6);
        expect(blobKeys).toEqual(
          expect.arrayContaining([
            expect.stringContaining(`${baseGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
            expect.stringContaining(`${contractResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
          ]),
        );

        // The base recomposition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

        // The contract recomposition and the feature flag composition
        await assertNumberOfCompositions(client, contractName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, contractKey, false);
      },
    );

    test(
      'that a feature flag that is disabled upon creation can be composed with contracts (namespace without labels)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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
        expect(blobStorage.keys()).toHaveLength(2);
        const baseGraphKey = blobStorage.keys()[0];
        const baseGraphMapKey = blobStorage.keys()[1];

        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/manifest/latest.json`);
        expect(baseGraphMapKey).toContain(`${baseGraphResponse.graph!.id}/manifest/mapper.json`);
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

        expect(blobStorage.keys()).toHaveLength(4);
        const contractKey = blobStorage.keys()[2];
        const contractMapperKey = blobStorage.keys()[3];
        const contractResponse = await client.getFederatedGraphByName({
          name: contractName,
          namespace,
        });
        expect(contractResponse.response?.code).toBe(EnumStatusCode.OK);

        expect(contractKey).toContain(`${contractResponse.graph!.id}/manifest/latest.json`);
        expect(contractMapperKey).toContain(`${contractResponse.graph!.id}/manifest/mapper.json`);
        await assertFeatureFlagExecutionConfig(blobStorage, contractKey, false);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], namespace);

        // No new compositions should have taken place
        expect(blobStorage.keys()).toHaveLength(4);
        await assertNumberOfCompositions(client, contractName, 1, namespace);
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        // Enable the feature flag to trigger new compositions
        await toggleFeatureFlag(client, featureFlagName, true, namespace);

        const blobKeys = blobStorage.keys();
        expect(blobKeys).toHaveLength(6);
        expect(blobKeys).toEqual(
          expect.arrayContaining([
            expect.stringContaining(`${baseGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
            expect.stringContaining(`${contractResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
          ]),
        );

        // The base recomposition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

        // The contract recomposition and the feature flag composition
        await assertNumberOfCompositions(client, contractName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, contractKey, false);
      },
    );

    test(
      'that publishing a feature subgraph that is not part of a feature flag does not trigger a composition',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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

        expect(blobStorage.keys()).toHaveLength(2);
        const baseGraphKey = blobStorage.keys()[0];
        const baseGraphMapperKey = blobStorage.keys()[1];

        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/manifest/latest.json`);
        expect(baseGraphMapperKey).toContain(`${baseGraphResponse.graph!.id}/manifest/mapper.json`);
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
      },
    );

    test(
      'that a feature flag can compose even if the base federated graph fails',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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

        expect(blobStorage.keys()).toHaveLength(2);
        const baseGraphKey = blobStorage.keys()[0];
        const baseGraphMapperKey = blobStorage.keys()[1];

        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/manifest/latest.json`);
        expect(baseGraphMapperKey).toContain(`${baseGraphResponse.graph!.id}/manifest/mapper.json`);
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

        expect(createFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${baseGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // There will be a failed base composition and one feature flag compositions
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
        await createAndPublishSubgraph(
          client,
          'products',
          namespace,
          fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/products.graphql`)).toString(),
          labels,
          DEFAULT_SUBGRAPH_URL_TWO,
        );

        // Composition should now trigger for the base graph
        await assertNumberOfCompositions(client, baseGraphName, 4, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);
      },
    );

    test(
      'that a feature flag that is enabled upon creation can be deleted despite contracts (namespace without labels)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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
        expect(blobStorage.keys()).toHaveLength(2);
        const baseGraphKey = blobStorage.keys()[0];
        const baseGraphMapperKey = blobStorage.keys()[1];

        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/manifest/latest.json`);
        expect(baseGraphMapperKey).toContain(`${baseGraphResponse.graph!.id}/manifest/mapper.json`);
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

        expect(blobStorage.keys()).toHaveLength(4);
        const contractKey = blobStorage.keys()[2];
        const contractMapperKey = blobStorage.keys()[3];
        const contractResponse = await client.getFederatedGraphByName({
          name: contractName,
          namespace,
        });

        expect(contractResponse.response?.code).toBe(EnumStatusCode.OK);
        expect(contractKey).toContain(`${contractResponse.graph!.id}/manifest/latest.json`);
        expect(contractMapperKey).toContain(`${contractResponse.graph!.id}/manifest/mapper.json`);
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

        const blobKeys = blobStorage.keys();
        expect(blobKeys).toHaveLength(6);
        expect(blobKeys).toEqual(
          expect.arrayContaining([
            expect.stringContaining(`${baseGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
            expect.stringContaining(`${contractResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
          ]),
        );

        // The base recomposition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

        // The contract recomposition and the feature flag composition
        await assertNumberOfCompositions(client, contractName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, contractKey, false);

        await deleteFeatureFlag(client, featureFlagName, namespace);
        expect(blobStorage.keys()).toHaveLength(4);

        // No recomposition should occur on the base federated graph
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

        // No recomposition should occur on the contract
        await assertNumberOfCompositions(client, contractName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, contractKey, false);

        // Attempting to delete the feature flag again should result in a 'not found' error
        const deleteFeatureFlagResponse = await client.deleteFeatureFlag({ name: featureFlagName, namespace });
        expect(deleteFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
        expect(deleteFeatureFlagResponse.response?.details).toBe(
          `The feature flag "${featureFlagName}" was not found.`,
        );
      },
    );

    test(
      'that publishing a change to a base subgraph produces new compositions for the base graph and contracts (but not for the feature flag itself)',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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

        expect(blobStorage.keys()).toHaveLength(2);
        const baseGraphKey = blobStorage.keys()[0];
        const baseGraphMapperKey = blobStorage.keys()[1];

        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/manifest/latest.json`);
        expect(baseGraphMapperKey).toContain(`${baseGraphResponse.graph!.id}/manifest/mapper.json`);
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

        expect(blobStorage.keys()).toHaveLength(4);
        const contractKey = blobStorage.keys()[2];
        const contractMapperKey = blobStorage.keys()[3];
        const contractResponse = await client.getFederatedGraphByName({
          name: contractName,
          namespace,
        });

        expect(contractResponse.response?.code).toBe(EnumStatusCode.OK);
        expect(contractKey).toContain(`${contractResponse.graph!.id}/manifest/latest.json`);
        expect(contractMapperKey).toContain(`${contractResponse.graph!.id}/manifest/mapper.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, contractKey, false);

        const graphNamesAndKeys: Array<GraphNameAndKey> = [
          { name: baseGraphName, key: baseGraphKey },
          { name: contractName, key: contractKey },
        ];

        // Both graphs should still be at a single composition
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

        const blobKeys = blobStorage.keys();
        expect(blobKeys).toHaveLength(6);
        expect(blobKeys).toEqual(
          expect.arrayContaining([
            expect.stringContaining(`${baseGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
            expect.stringContaining(`${contractResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
          ]),
        );

        // There should be a new feature flag composition
        for (const { name, key } of graphNamesAndKeys) {
          await assertNumberOfCompositions(client, name, 2, namespace);
          await assertFeatureFlagExecutionConfig(blobStorage, key, false);
        }

        const publishResponse = await client.publishFederatedSubgraph({
          name: 'users',
          namespace,
          schema: fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users-update.graphql`)).toString(),
        });
        expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

        // There should be a base recomposition but no feature flag recomposition (users is overridden)
        for (const { name, key } of graphNamesAndKeys) {
          await assertNumberOfCompositions(client, name, 3, namespace);
          await assertFeatureFlagExecutionConfig(blobStorage, key, false);
        }
      },
    );

    test(
      'test that multiple federated graphs and contracts compose and deploy correctly',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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

        expect(blobStorage.keys()).toHaveLength(2);
        const baseGraphKeyOne = blobStorage.keys()[0];
        const baseGraphMapperKeyOne = blobStorage.keys()[1];

        expect(baseGraphKeyOne).toContain(`${baseGraphResponseOne.graph!.id}/manifest/latest.json`);
        expect(baseGraphMapperKeyOne).toContain(`${baseGraphResponseOne.graph!.id}/manifest/mapper.json`);
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

        expect(blobStorage.keys()).toHaveLength(4);
        const contractKeyOne = blobStorage.keys()[2];
        const contractMapperKeyOne = blobStorage.keys()[3];
        const contractResponseOne = await client.getFederatedGraphByName({
          name: contractNameOne,
          namespace,
        });

        expect(contractResponseOne.response?.code).toBe(EnumStatusCode.OK);
        expect(contractKeyOne).toContain(`${contractResponseOne.graph!.id}/manifest/latest.json`);
        expect(contractMapperKeyOne).toContain(`${contractResponseOne.graph!.id}/manifest/mapper.json`);
        await assertFeatureFlagExecutionConfig(blobStorage, contractKeyOne, false);

        const baseGraphNameTwo = genID('baseGraphNameTwo');
        await createFederatedGraph(client, baseGraphNameTwo, namespace, [], 'http://localhost:3003');
        const baseGraphResponseTwo = await client.getFederatedGraphByName({
          name: baseGraphNameTwo,
          namespace,
        });

        // Base graph two composition
        await assertNumberOfCompositions(client, baseGraphNameTwo, 1, namespace);

        expect(blobStorage.keys()).toHaveLength(6);
        const baseGraphKeyTwo = blobStorage.keys()[4];
        const baseGraphMapperKeyTwo = blobStorage.keys()[5];

        expect(baseGraphKeyTwo).toContain(`${baseGraphResponseTwo.graph!.id}/manifest/latest.json`);
        expect(baseGraphMapperKeyTwo).toContain(`${baseGraphResponseTwo.graph!.id}/manifest/mapper.json`);
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

        expect(blobStorage.keys()).toHaveLength(8);
        const contractKeyTwo = blobStorage.keys()[6];
        const contractMapperKeyTwo = blobStorage.keys()[7];
        const contractResponseTwo = await client.getFederatedGraphByName({
          name: contractNameTwo,
          namespace,
        });

        expect(contractResponseTwo.response?.code).toBe(EnumStatusCode.OK);
        expect(contractKeyTwo).toContain(`${contractResponseTwo.graph!.id}/manifest/latest.json`);
        expect(contractMapperKeyTwo).toContain(`${contractResponseTwo.graph!.id}/manifest/mapper.json`);
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

        let blobKeys = blobStorage.keys();
        expect(blobKeys).toHaveLength(12);
        expect(blobKeys).toEqual(
          expect.arrayContaining([
            expect.stringContaining(`${baseGraphResponseOne.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
            expect.stringContaining(`${baseGraphResponseTwo.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
            expect.stringContaining(`${contractResponseOne.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
            expect.stringContaining(`${contractResponseTwo.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
          ]),
        );

        /*
         * Each federated graph should have produced two total compositions:
         *  1. The original base composition
         *  2. The feature flag composition
         *
         * Each config should NOT contain an embedded a feature flag config
         * */
        for (const { name, key } of graphNamesAndKeys) {
          await assertNumberOfCompositions(client, name, 2, namespace);
          await assertFeatureFlagExecutionConfig(blobStorage, key, false);
        }

        const publishResponse = await client.publishFederatedSubgraph({
          name: 'users',
          namespace,
          schema: fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users-update.graphql`)).toString(),
        });
        expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

        // Each graph should have produced one new composition: the base recomposition
        for (const { name, key } of graphNamesAndKeys) {
          await assertNumberOfCompositions(client, name, 3, namespace);
          await assertFeatureFlagExecutionConfig(blobStorage, key, false);
        }

        await toggleFeatureFlag(client, featureFlagName, false, namespace);

        // There should not be any new recomposition, but the feature flags artifacts should be removed
        expect(blobStorage.keys()).toHaveLength(8);

        await toggleFeatureFlag(client, featureFlagName, true, namespace);

        // Each graph should have produced one new composition: the featured flag recomposition
        for (const { name, key } of graphNamesAndKeys) {
          await assertNumberOfCompositions(client, name, 4, namespace);
          await assertFeatureFlagExecutionConfig(blobStorage, key, false);
        }

        blobKeys = blobStorage.keys();
        expect(blobKeys).toHaveLength(12);
        expect(blobKeys).toEqual(
          expect.arrayContaining([
            expect.stringContaining(`${baseGraphResponseOne.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
            expect.stringContaining(`${baseGraphResponseTwo.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
            expect.stringContaining(`${contractResponseOne.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
            expect.stringContaining(`${contractResponseTwo.graph!.id}/manifest/feature-flags/${featureFlagName}.json`),
          ]),
        );

        const deleteFeatureSubgraphResponse = await client.deleteFederatedSubgraph({
          subgraphName: 'products-feature',
          namespace,
        });

        expect(deleteFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

        // Only the federated graph should have been recomposed
        for (const { name, key } of graphNamesAndKeys) {
          await assertNumberOfCompositions(client, name, 5, namespace);
          await assertFeatureFlagExecutionConfig(blobStorage, key, false);
        }
      },
    );

    test(
      'that a feature subgraph is never included in the base composition',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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

        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);

        await assertExecutionConfigSubgraphNames(blobStorage, key, subgraphIds);
      },
    );

    test(
      'that setting a feature flag to its current state does not trigger composition',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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

        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];

        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1);

        const featureFlagName = genID('flag');
        await createFeatureFlag(
          client,
          featureFlagName,
          labels,
          ['users-feature', 'products-feature'],
          'default',
          true,
        );

        const ffKey = blobStorage.keys()[2];
        expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The base recomposition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The feature flag is already enabled, so this enable should do nothing
        await toggleFeatureFlag(client, featureFlagName, true);

        expect(blobStorage.keys()).toHaveLength(3);

        // Expect compositions to remain at 2
        await assertNumberOfCompositions(client, baseGraphName, 2);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // Disable the feature flag
        await toggleFeatureFlag(client, featureFlagName, false);

        expect(blobStorage.keys()).toHaveLength(2);

        // Don't expect a recomposition
        await assertNumberOfCompositions(client, baseGraphName, 2);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The feature flag is already disabled, so this disable should do nothing
        await toggleFeatureFlag(client, featureFlagName, false);

        // Expect compositions to remain at 2
        await assertNumberOfCompositions(client, baseGraphName, 2);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);
      },
    );

    test(
      'that `feature subgraph publish` recomposes the feature flag',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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

        expect(blobStorage.keys()).toHaveLength(2);
        const baseGraphKey = blobStorage.keys()[0];
        const baseGraphMapperKey = blobStorage.keys()[1];

        expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/manifest/latest.json`);
        expect(baseGraphMapperKey).toContain(`${baseGraphResponse.graph!.id}/manifest/mapper.json`);
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
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
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

        /*
         * The "products-feature" feature subgraph is not yet part of the feature flag, so the number of compositions
         * should remain the same
         */
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

        const updateFeatureFlagResponse = await client.updateFeatureFlag({
          featureSubgraphNames: ['users-feature', 'products-feature'],
          name: featureFlagName,
          namespace,
        });

        expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${baseGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);

        const publishSubgraphResponse = await client.publishFederatedSubgraph({
          name: 'products-feature',
          namespace,
          schema: fs
            .readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-feature-update.graphql`))
            .toString(),
        });

        expect(publishSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

        // Another feature flag recomposition
        await assertNumberOfCompositions(client, baseGraphName, 4, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);
      },
    );

    test(
      'that a federated graph with feature flags and feature subgraphs can be moved',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server } = await SetupTest({ dbname, chClient, enabledFeatures: ['split-config-loading'] });
        testContext.onTestFinished(() => server.close());

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

        await createFeatureFlag(
          client,
          featureFlagName,
          labels,
          ['users-feature', 'products-feature'],
          namespace,
          true,
        );

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
          unsuccessfulBaseCompositionError(baseGraphName, newNamespace),
        );

        /**
         * The federated graph is moved without its subgraphs.
         * Subgraphs that form the base of feature subgraphs cannot be moved
         */
        const fedGraphByNameResp = await client.getFederatedGraphByName({
          name: baseGraphName,
          namespace: newNamespace,
        });
        expect(fedGraphByNameResp.response?.code).toBe(EnumStatusCode.OK);

        // The feature flag cannot be moved because the feature subgraphs cannot be moved
        const featureFlagByNameResp = await client.getFeatureFlagByName({
          name: featureFlagName,
          namespace: newNamespace,
        });
        expect(featureFlagByNameResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      },
    );

    test(
      'that a federated graph with a contract, feature flags, and feature subgraphs can be moved',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server } = await SetupTest({ dbname, chClient, enabledFeatures: ['split-config-loading'] });
        testContext.onTestFinished(() => server.close());

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

        await createFeatureFlag(
          client,
          featureFlagName,
          labels,
          ['users-feature', 'products-feature'],
          namespace,
          true,
        );

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
          unsuccessfulBaseCompositionError(baseGraphName, newNamespace),
        );

        /**
         * The federated graph is moved without its subgraphs.
         * Subgraphs that form the base of feature subgraphs cannot be moved
         */
        const fedGraphByNameResp = await client.getFederatedGraphByName({
          name: baseGraphName,
          namespace: newNamespace,
        });
        expect(fedGraphByNameResp.response?.code).toBe(EnumStatusCode.OK);

        const contractResp = await client.getFederatedGraphByName({ name: contractName, namespace: newNamespace });
        expect(contractResp.response?.code).toBe(EnumStatusCode.OK);

        // The feature flag cannot be moved because the feature subgraphs cannot be moved
        const featureFlagByNameResp = await client.getFeatureFlagByName({
          name: featureFlagName,
          namespace: newNamespace,
        });
        expect(featureFlagByNameResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      },
    );

    test(
      'that a feature flag whose labels are updated recomposes the feature flag successfully',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

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

        expect(blobStorage.keys()).toHaveLength(2);
        const federatedGraphKeyOne = blobStorage.keys()[0];
        const federatedGraphKeyMapperOne = blobStorage.keys()[1];

        expect(federatedGraphKeyOne).toContain(`${federatedGraphResponseOne.graph!.id}/manifest/latest.json`);
        expect(federatedGraphKeyMapperOne).toContain(`${federatedGraphResponseOne.graph!.id}/manifest/mapper.json`);
        await assertFeatureFlagExecutionConfig(blobStorage, federatedGraphKeyOne, false);

        // The base composition of graph one
        await assertNumberOfCompositions(client, baseGraphNameOne, 1, namespace);

        await createFederatedGraph(client, baseGraphNameTwo, namespace, ['team=B'], 'http://localhost:3003');
        const federatedGraphResponseTwo = await client.getFederatedGraphByName({
          name: baseGraphNameTwo,
          namespace,
        });

        expect(blobStorage.keys()).toHaveLength(4);
        const federatedGraphKeyTwo = blobStorage.keys()[2];
        const federatedGraphKeyMapperTwo = blobStorage.keys()[3];

        expect(federatedGraphKeyTwo).toContain(`${federatedGraphResponseTwo.graph!.id}/manifest/latest.json`);
        expect(federatedGraphKeyMapperTwo).toContain(`${federatedGraphResponseTwo.graph!.id}/manifest/mapper.json`);
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

        let blobKeys = blobStorage.keys();
        expect(blobKeys.length).toBe(5);
        expect(blobKeys).toEqual(
          expect.arrayContaining([
            expect.stringContaining(`${federatedGraphResponseOne.graph!.id}/manifest/latest.json`),
            expect.stringContaining(`${federatedGraphResponseOne.graph!.id}/manifest/mapper.json`),
            expect.stringContaining(
              `${federatedGraphResponseOne.graph!.id}/manifest/feature-flags/${featureFlagName}.json`,
            ),
            expect.stringContaining(`${federatedGraphResponseTwo.graph!.id}/manifest/latest.json`),
            expect.stringContaining(`${federatedGraphResponseTwo.graph!.id}/manifest/mapper.json`),
          ]),
        );

        // The base composition of graph one and the new feature flag composition
        await assertNumberOfCompositions(client, baseGraphNameOne, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, federatedGraphKeyOne, false);

        // The compositions of graph two should remain unchanged
        await assertNumberOfCompositions(client, baseGraphNameTwo, 1, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, federatedGraphKeyTwo, false);

        const updateFeatureFlagResponse = await client.updateFeatureFlag({
          name: featureFlagName,
          namespace,
          labels: [secondLabel],
        });
        expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

        // The base composition of graph one and the feature flag composition (no changes)
        await assertNumberOfCompositions(client, baseGraphNameOne, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, federatedGraphKeyOne, false);

        // The base composition of graph two and the new feature flag composition
        await assertNumberOfCompositions(client, baseGraphNameTwo, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, federatedGraphKeyTwo, false);

        blobKeys = blobStorage.keys();
        expect(blobKeys.length).toBe(5);
        expect(blobKeys).toEqual(
          expect.arrayContaining([
            expect.stringContaining(`${federatedGraphResponseOne.graph!.id}/manifest/latest.json`),
            expect.stringContaining(`${federatedGraphResponseOne.graph!.id}/manifest/mapper.json`),
            expect.stringContaining(`${federatedGraphResponseTwo.graph!.id}/manifest/latest.json`),
            expect.stringContaining(`${federatedGraphResponseTwo.graph!.id}/manifest/mapper.json`),
            expect.stringContaining(
              `${federatedGraphResponseTwo.graph!.id}/manifest/feature-flags/${featureFlagName}.json`,
            ),
          ]),
        );
      },
    );

    test(
      'that a feature flag is not recomposed if the base subgraph of a feature subgraph is published or updated',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);

        const labels = [{ key: 'team', value: 'A' }];
        const baseGraphName = genID('baseFederatedGraphName');
        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: false },
            { name: 'products', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        expect(blobStorage.keys()).toHaveLength(3);

        const updateResp = await client.updateSubgraph({
          name: 'products',
          namespace,
          routingUrl: 'http://example.com',
        });

        expect(updateResp.response?.code).toBe(EnumStatusCode.OK);
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);

        const publishResp = await client.publishFederatedSubgraph({
          name: 'products',
          namespace,
          schema: fs
            .readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-update.graphql`))
            .toString(),
        });

        expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

        // Another base recomposition
        await assertNumberOfCompositions(client, baseGraphName, 4, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        expect(blobStorage.keys()).toHaveLength(3);
      },
    );

    test(
      'that a feature flag is recomposed if a mutual subgraph is published or updated',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);

        const labels = [{ key: 'team', value: 'A' }];
        const baseGraphName = genID('baseFederatedGraphName');
        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: false },
            { name: 'products', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        expect(blobStorage.keys()).toHaveLength(3);

        const updateResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          routingUrl: 'http://example.com',
        });

        expect(updateResp.response?.code).toBe(EnumStatusCode.OK);
        await assertNumberOfCompositions(client, baseGraphName, 4, namespace);

        const publishResp = await client.publishFederatedSubgraph({
          name: 'users',
          namespace,
          schema: fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users-update.graphql`)).toString(),
        });

        expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

        // Another base recomposition
        await assertNumberOfCompositions(client, baseGraphName, 6, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        expect(blobStorage.keys()).toHaveLength(3);
      },
    );

    // TODO: We need to decide what to do with orphaned feature flags
    test.todo(
      'that a feature flag need not share any mutual subgraphs',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        await createNamespace(client, namespace);

        const labelMatcher = [
          { key: 'team', value: 'A' },
          { key: 'team', value: 'C' },
        ];
        const labels1 = [{ key: 'team', value: 'A' }];
        const labels2 = [{ key: 'team', value: 'B' }];
        const products = genID('products');
        const users = genID('users');
        const usersFeature = `${users}-feature`;
        const baseGraphName = genID('baseFederatedGraphName');
        const featureFlagName = genID('flag');

        await createAndPublishSubgraph(
          client,
          products,
          namespace,
          fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-standalone.graphql`)).toString(),
          labels1,
          DEFAULT_SUBGRAPH_URL_ONE,
        );

        await createAndPublishSubgraph(
          client,
          users,
          namespace,
          fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users.graphql`)).toString(),
          labels2,
          DEFAULT_SUBGRAPH_URL_TWO,
        );

        await createFederatedGraph(
          client,
          baseGraphName,
          namespace,
          [labelMatcher.map((l) => `${l.key}=${l.value}`).join(',')],
          DEFAULT_ROUTER_URL,
        );
        const federatedGraphResponse = await client.getFederatedGraphByName({
          name: baseGraphName,
          namespace,
        });

        expect(federatedGraphResponse.response?.code).toBe(EnumStatusCode.OK);
        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);

        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);
        await createThenPublishFeatureSubgraph(
          client,
          usersFeature,
          users,
          namespace,
          fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users-feature.graphql`)).toString(),
          labels2,
          DEFAULT_SUBGRAPH_URL_THREE,
        );

        await createFeatureFlag(client, featureFlagName, labels2, [usersFeature], namespace, true);

        let featureFlagCompositions = await server.db
          .select({ id: graphCompositions.id })
          .from(graphCompositions)
          .where(eq(graphCompositions.isFeatureFlagComposition, true))
          .execute();

        expect(featureFlagCompositions).toHaveLength(1);

        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const updateProductsResp = await client.updateSubgraph({
          name: products,
          namespace,
          routingUrl: 'http://example.com',
        });

        expect(updateProductsResp.response?.code).toBe(EnumStatusCode.OK);
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

        featureFlagCompositions = await server.db
          .select({ id: graphCompositions.id })
          .from(graphCompositions)
          .where(eq(graphCompositions.isFeatureFlagComposition, true))
          .execute();

        expect(featureFlagCompositions).toHaveLength(1);

        const publishProductsResp = await client.publishFederatedSubgraph({
          name: products,
          namespace,
          schema: fs
            .readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-standalone-update.graphql`))
            .toString(),
        });

        expect(publishProductsResp.response?.code).toBe(EnumStatusCode.OK);
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);

        featureFlagCompositions = await server.db
          .select({ id: graphCompositions.id })
          .from(graphCompositions)
          .where(eq(graphCompositions.isFeatureFlagComposition, true))
          .execute();

        expect(featureFlagCompositions).toHaveLength(1);

        const updateUsersResp = await client.updateSubgraph({
          name: users,
          namespace,
          routingUrl: 'http://example.com',
        });

        expect(updateUsersResp.response?.code).toBe(EnumStatusCode.OK);
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);

        featureFlagCompositions = await server.db
          .select({ id: graphCompositions.id })
          .from(graphCompositions)
          .where(eq(graphCompositions.isFeatureFlagComposition, true))
          .execute();

        expect(featureFlagCompositions).toHaveLength(2);

        const publishUsersResp = await client.publishFederatedSubgraph({
          name: users,
          namespace,
          schema: fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users-update.graphql`)).toString(),
        });

        expect(publishUsersResp.response?.code).toBe(EnumStatusCode.OK);
        await assertNumberOfCompositions(client, baseGraphName, 3, namespace);

        featureFlagCompositions = await server.db
          .select({ id: graphCompositions.id })
          .from(graphCompositions)
          .where(eq(graphCompositions.isFeatureFlagComposition, true))
          .execute();

        expect(featureFlagCompositions).toHaveLength(3);
      },
    );

    test(
      'that when a subgraph label changes, all affected graphs and feature flags are recomposed',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        const labels = [{ key: 'team', value: 'A' }];
        const baseGraphName = genID('baseFederatedGraphName');

        await createNamespace(client, namespace);

        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: true },
            { name: 'products-standalone', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // Update the labels of the subgraph
        let updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          labels: [{ key: 'team', value: 'B' }],
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // The base graph and feature flag should have recomposed
        await assertNumberOfCompositions(client, baseGraphName, 4, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // Update the labels of the subgraph
        updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          labels: [{ key: 'team', value: 'A' }],
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // The base graph and feature flag should have recomposed
        await assertNumberOfCompositions(client, baseGraphName, 6, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);
      },
    );

    test(
      'that setting new labels that do not affect existing label matchers does not produce unnecessary recompositions',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        const labels = [{ key: 'team', value: 'A' }];
        const baseGraphName = genID('baseFederatedGraphName');

        await createNamespace(client, namespace);

        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: true },
            { name: 'products-standalone', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // Update the labels of the subgraph
        const updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          labels: [
            { key: 'team', value: 'B' },
            { key: 'team', value: 'A' },
          ],
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // There should not be any new recomposition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);
      },
    );

    test(
      'that changing the routing url triggers a recomposition when label matchers do not change',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        const labels = [{ key: 'team', value: 'A' }];
        const baseGraphName = genID('baseFederatedGraphName');

        await createNamespace(client, namespace);

        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: true },
            { name: 'products-standalone', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // Update the labels of the subgraph
        const updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          labels: [
            { key: 'team', value: 'B' },
            { key: 'team', value: 'A' },
          ],
          routingUrl: DEFAULT_SUBGRAPH_URL_THREE,
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // There should be a recomposition for the federated graph and feature flag
        await assertNumberOfCompositions(client, baseGraphName, 4, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);
      },
    );

    test(
      'that changing the routing url and the labels of a mutual subgraph trigger composition',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        const labels = [{ key: 'team', value: 'A' }];
        const baseGraphName = genID('baseFederatedGraphName');

        await createNamespace(client, namespace);

        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: true },
            { name: 'products-standalone', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // Update the labels of the subgraph
        const updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          labels: [{ key: 'team', value: 'B' }],
          routingUrl: DEFAULT_SUBGRAPH_URL_THREE,
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // There should be a recomposition for the federated graph and feature flag
        await assertNumberOfCompositions(client, baseGraphName, 4, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);
      },
    );

    test(
      'that unsetting non-empty labels triggers composition',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        const labels: Label[] = [{ key: 'team', value: 'A' }];
        const baseGraphName = genID('baseFederatedGraphName');

        await createNamespace(client, namespace);

        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: true },
            { name: 'products-standalone', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // Update the labels of the subgraph
        const updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          unsetLabels: true,
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // There should be a recomposition for the federated graph and feature flag
        await assertNumberOfCompositions(client, baseGraphName, 4, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);
      },
    );

    test(
      'that unsetting empty labels does not trigger composition',
      getDebugTestOptions(isDebugMode),
      async (testContext) => {
        const { client, server, blobStorage } = await SetupTest({
          dbname,
          chClient,
          enabledFeatures: ['split-config-loading'],
        });
        testContext.onTestFinished(() => server.close());

        const namespace = genID('namespace').toLowerCase();
        const labels: Label[] = [];
        const baseGraphName = genID('baseFederatedGraphName');

        await createNamespace(client, namespace);

        const federatedGraphResponse = await featureFlagIntegrationTestSetUp(
          client,
          [
            { name: 'users', hasFeatureSubgraph: true },
            { name: 'products-standalone', hasFeatureSubgraph: true },
          ],
          baseGraphName,
          labels,
          namespace,
        );

        expect(blobStorage.keys()).toHaveLength(2);
        const key = blobStorage.keys()[0];
        const mapperKey = blobStorage.keys()[1];
        expect(key).toContain(`${federatedGraphResponse.graph!.id}/manifest/latest.json`);
        expect(mapperKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/mapper.json`);

        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // The base composition
        await assertNumberOfCompositions(client, baseGraphName, 1, namespace);

        const featureFlagName = genID('flag');
        await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

        expect(blobStorage.keys()).toHaveLength(3);
        const ffKey = blobStorage.keys().at(-1);
        expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

        // The base composition and the feature flag composition
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);

        // Update the labels of the subgraph
        const updateSubgraphResp = await client.updateSubgraph({
          name: 'users',
          namespace,
          unsetLabels: true,
        });

        expect(updateSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

        // There should be a recomposition for the federated graph and feature flag
        await assertNumberOfCompositions(client, baseGraphName, 2, namespace);
        await assertFeatureFlagExecutionConfig(blobStorage, key, false);
      },
    );
  });
});
