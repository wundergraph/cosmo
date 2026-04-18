import fs from 'node:fs';
import { join } from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
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
