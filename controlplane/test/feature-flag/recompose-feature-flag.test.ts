import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import {
  assertFeatureFlagExecutionConfig,
  assertNumberOfCompositions,
  createAndPublishSubgraph,
  createFeatureFlag,
  createFederatedGraph,
  createThenPublishFeatureSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  featureFlagIntegrationTestSetUp,
  getDebugTestOptions,
  SetupTest,
} from '../test-util.js';
import { Label } from '../../src/types/index.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';

// Change to true to enable a longer timeout
const isDebugMode = false;
let dbname = '';

// Base "monolith" lacks `isPending`; the versioned feature subgraph adds it back on republish.
const usersSDL = `type Query { users: [User!]! } type User @key(fields: "id") { id: ID! email: String! }`;
const monolithBaseSDL = `type User @key(fields: "id") { id: ID! name: String! }`;
const monolithFeatureSDL = `type User @key(fields: "id") { id: ID! name: String! isPending: Boolean! }`;

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

  test(
    'that republishing a feature subgraph with new fields updates the feature flag supergraph',
    getDebugTestOptions(isDebugMode),
    async (testContext) => {
      const { client, server } = await SetupTest({ dbname, chClient, enabledFeatures: ['split-config-loading'] });
      testContext.onTestFinished(() => server.close());

      const labels: Label[] = [{ key: 'team', value: 'A' }];

      await createAndPublishSubgraph(client, 'users', DEFAULT_NAMESPACE, usersSDL, labels, DEFAULT_SUBGRAPH_URL_ONE);
      await createAndPublishSubgraph(
        client,
        'monolith',
        DEFAULT_NAMESPACE,
        monolithBaseSDL,
        labels,
        DEFAULT_SUBGRAPH_URL_TWO,
      );
      await createThenPublishFeatureSubgraph(
        client,
        'users-feature',
        'users',
        DEFAULT_NAMESPACE,
        usersSDL,
        labels,
        'http://localhost:4101',
      );
      // monolith-feature published v1: WITHOUT `isPending`.
      await createThenPublishFeatureSubgraph(
        client,
        'monolith-feature',
        'monolith',
        DEFAULT_NAMESPACE,
        monolithBaseSDL,
        labels,
        'http://localhost:4102',
      );

      const federatedGraphName = genID('fedGraph');
      await createFederatedGraph(client, federatedGraphName, DEFAULT_NAMESPACE, ['team=A'], DEFAULT_ROUTER_URL);

      const featureFlagName = genID('flag');
      await createFeatureFlag(
        client,
        featureFlagName,
        labels,
        ['users-feature', 'monolith-feature'],
        DEFAULT_NAMESPACE,
        true,
      );

      const featureFlagSdl = () =>
        client.getFederatedGraphSDLByName({ name: federatedGraphName, namespace: DEFAULT_NAMESPACE, featureFlagName });

      // v1 has no `isPending` as the feature subgraph schema was the same as the base graph schema and the base graph schema had no `isPending`.
      const sdlV1 = await featureFlagSdl();
      expect(sdlV1.response?.code).toBe(EnumStatusCode.OK);
      expect(sdlV1.sdl).not.toContain('isPending');

      // Republish monolith-feature v2: now WITH `isPending`.
      const republish = await client.publishFederatedSubgraph({
        name: 'monolith-feature',
        namespace: DEFAULT_NAMESPACE,
        schema: monolithFeatureSDL,
      });
      expect(republish.response?.code).toBe(EnumStatusCode.OK);

      // The feature flag supergraph must now reflect the republished schema and contain `isPending`.
      const sdlV2 = await featureFlagSdl();
      expect(sdlV2.response?.code).toBe(EnumStatusCode.OK);
      expect(sdlV2.sdl).toContain('isPending');
    },
  );
});
