import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import {
  assertFeatureFlagExecutionConfig,
  assertNumberOfCompositions,
  createFeatureFlag,
  featureFlagIntegrationTestSetUp,
  getDebugTestOptions,
  SetupTest,
} from '../test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';

// Change to true to enable a longer timeout
const isDebugMode = false;
let dbname = '';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Recompose feature flag tests', () => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });
  afterEach(() => vi.clearAllMocks());
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });
  afterAll(() => afterAllSetup(dbname));

  test(
    'that an error is returned when configuration splitting is not enabled',
    getDebugTestOptions(isDebugMode),
    async (textContext) => {
      const { client, server } = await SetupTest({ dbname, chClient });
      textContext.onTestFinished(() => server.close());

      const labels = [{ key: 'team', value: 'A' }];
      const baseGraphName = genID('baseFederatedGraphName');

      await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
        ],
        baseGraphName,
        labels,
      );

      const featureFlagName = genID('flag');
      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], 'default', true);

      const recomposeResp = await client.recomposeFeatureFlag({ name: featureFlagName });
      expect(recomposeResp.response?.code).toBe(EnumStatusCode.ERR);
      expect(recomposeResp.response?.details).toBe('Configuration splitting not enabled');
    },
  );

  test(
    'that an error is returned when namespace does not exist',
    getDebugTestOptions(isDebugMode),
    async (textContext) => {
      const { client, server } = await SetupTest({ dbname, chClient, enabledFeatures: ['split-config-loading'] });
      textContext.onTestFinished(() => server.close());

      const labels = [{ key: 'team', value: 'A' }];
      const baseGraphName = genID('baseFederatedGraphName');

      await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
        ],
        baseGraphName,
        labels,
      );

      const featureFlagName = genID('flag');
      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], 'default', true);

      const recomposeResp = await client.recomposeFeatureFlag({
        name: featureFlagName,
        namespace: 'unknown-namespace',
      });

      expect(recomposeResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(recomposeResp.response?.details).toBe('Could not find namespace unknown-namespace');
    },
  );

  test(
    'that an error is returned when feature flag does not exist',
    getDebugTestOptions(isDebugMode),
    async (textContext) => {
      const { client, server } = await SetupTest({ dbname, chClient, enabledFeatures: ['split-config-loading'] });
      textContext.onTestFinished(() => server.close());

      const labels = [{ key: 'team', value: 'A' }];
      const baseGraphName = genID('baseFederatedGraphName');

      await featureFlagIntegrationTestSetUp(
        client,
        [
          { name: 'users', hasFeatureSubgraph: true },
          { name: 'products', hasFeatureSubgraph: true },
        ],
        baseGraphName,
        labels,
      );

      const featureFlagName = genID('flag');
      const recomposeResp = await client.recomposeFeatureFlag({ name: featureFlagName });

      expect(recomposeResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(recomposeResp.response?.details).toBe(`The feature flag "${featureFlagName}" was not found`);
    },
  );

  test('that a feature flag is recomposed successfully', getDebugTestOptions(isDebugMode), async (testContext) => {
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
    await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], 'default', true);

    expect(blobStorage.keys()).toHaveLength(3);
    const ffKey = blobStorage.keys().at(-1);
    expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

    // The base recomposition and the feature flag composition
    await assertNumberOfCompositions(client, baseGraphName, 2);

    // Recompose the feature flag
    const recomposeResp = await client.recomposeFeatureFlag({ name: featureFlagName });

    expect(recomposeResp.response?.code).toBe(EnumStatusCode.OK);

    // The feature flag recomposition
    await assertNumberOfCompositions(client, baseGraphName, 3);
  });

  test(
    'that a feature flag is recomposed for contracts successfully',
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
      await createFeatureFlag(client, featureFlagName, labels, ['users-feature', 'products-feature'], 'default', true);

      expect(blobStorage.keys()).toHaveLength(3);
      const ffKey = blobStorage.keys().at(-1);
      expect(ffKey).toContain(`${federatedGraphResponse.graph!.id}/manifest/feature-flags/${featureFlagName}.json`);

      // The base recomposition and the feature flag composition
      await assertNumberOfCompositions(client, baseGraphName, 2);

      // Create contract
      const contractName = genID('contract');
      const createContractResponse = await client.createContract({
        name: contractName,
        sourceGraphName: baseGraphName,
        excludeTags: ['exclude'],
        routingUrl: 'http://localhost:3003',
      });
      expect(createContractResponse.response?.code).toBe(EnumStatusCode.OK);

      // The contract composition
      await assertNumberOfCompositions(client, contractName, 1);

      // Recompose the feature flag
      const recomposeResp = await client.recomposeFeatureFlag({ name: featureFlagName });

      expect(recomposeResp.response?.code).toBe(EnumStatusCode.OK);

      // The feature flag recomposition
      await assertNumberOfCompositions(client, baseGraphName, 3);
      await assertNumberOfCompositions(client, contractName, 2);
    },
  );
});
