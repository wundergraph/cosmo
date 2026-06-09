import fs from 'node:fs';
import { join } from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { formatISO } from 'date-fns';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  createAndPublishSubgraph,
  createFeatureFlag,
  createFederatedGraph,
  createThenPublishFeatureSubgraph,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  SetupTest,
  toggleFeatureFlag
} from '../test-util.js';

let dbname = '';

describe('GetFeatureFlagsInLatestCompositionByFederatedGraph', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return only feature flags in the latest valid composition', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const labels = [genUniqueLabel()];
    const federatedGraphName = genID('fedGraph');

    await createAndPublishSubgraph(
      client,
      'users',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users.graphql')).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishFeatureSubgraph(
      client,
      'users-feature',
      'users',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users-feature.graphql')).toString(),
      labels,
      'http://localhost:4101',
    );

    const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
    await createFederatedGraph(client, federatedGraphName, 'default', federatedGraphLabels, DEFAULT_ROUTER_URL);

    const flagName = genID('flag');
    await createFeatureFlag(client, flagName, labels, ['users-feature'], 'default', true);

    const resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.featureFlags.length).toBeGreaterThanOrEqual(1);
    expect(resp.featureFlags.some((f) => f.name === flagName)).toBe(true);
  });

  test('Should return each feature flag only once when it has multiple compositions against the same base', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['split-config-loading'] });
    testContext.onTestFinished(() => server.close());

    const labels = [genUniqueLabel()];
    const federatedGraphName = genID('fedGraph');

    await createAndPublishSubgraph(
      client,
      'users',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users.graphql')).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishFeatureSubgraph(
      client,
      'users-feature',
      'users',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users-feature.graphql')).toString(),
      labels,
      'http://localhost:4101',
    );

    const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
    await createFederatedGraph(client, federatedGraphName, 'default', federatedGraphLabels, DEFAULT_ROUTER_URL);

    const flagName = genID('flag');
    await createFeatureFlag(client, flagName, labels, ['users-feature'], 'default', true);

    // recomposeFeatureFlag recomposes only the feature flag against the existing base composition (the base
    // schema version is unchanged). Each call creates another feature flag composition for the same
    // (base composition, feature flag) pair, which is the source of the duplicates in the dropdown.
    for (let i = 0; i < 2; i++) {
      const recomposeResp = await client.recomposeFeatureFlag({ name: flagName, namespace: 'default' });
      expect(recomposeResp.response?.code).toBe(EnumStatusCode.OK);
    }

    const resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    // Despite multiple accumulated composition rows, the flag must appear exactly once.
    expect(resp.featureFlags.filter((f) => f.name === flagName)).toHaveLength(1);
    expect(resp.featureFlags).toHaveLength(1);

    // Create a second, enabled feature flag. It is composed into the latest composition, so it shows up too.
    const secondFlagName = genID('flag');
    await createFeatureFlag(client, secondFlagName, labels, ['users-feature'], 'default', true);

    const withSecondFlag = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
    });
    expect(withSecondFlag.response?.code).toBe(EnumStatusCode.OK);
    expect(withSecondFlag.featureFlags.map((f) => f.name).sort()).toEqual([flagName, secondFlagName].sort());

    await toggleFeatureFlag(client, secondFlagName, false, 'default');

    const afterDisable = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
    });
    expect(afterDisable.response?.code).toBe(EnumStatusCode.OK);
    expect(afterDisable.featureFlags).toHaveLength(1);
    expect(afterDisable.featureFlags[0].name).toBe(flagName);
  });

  test('Should return empty list when no feature flags exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const labels = [genUniqueLabel()];
    const federatedGraphName = genID('fedGraph');

    await createAndPublishSubgraph(
      client,
      genID('subgraph'),
      'default',
      'type Query { hello: String! }',
      labels,
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
    await createFederatedGraph(client, federatedGraphName, 'default', federatedGraphLabels, DEFAULT_ROUTER_URL);

    const resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.featureFlags).toHaveLength(0);
  });

  test('Should return ERR_NOT_FOUND for non-existent federated graph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName: 'non-existent-graph',
      namespace: 'default',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });
});
