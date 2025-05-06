import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
  createBaseAndFeatureSubgraph,
} from '../test-util.js';

let dbname = '';

describe('List feature flags', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to list feature flags of different namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const flagName = genID('flag');

    const createNamespaceResp = await client.createNamespace({
      name: 'prod',
    });

    expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
      'prod',
    );

    let featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
      isEnabled: true,
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
      namespace: 'prod',
      isEnabled: true,
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    // fetching feature flags from default namespace
    let listFeatureFlagsResp = await client.getFeatureFlags({
      namespace: 'default',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureFlagsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureFlagsResp.totalCount).toBe(1);

    // fetching feature flags from prod namespace
    listFeatureFlagsResp = await client.getFeatureFlags({
      namespace: 'prod',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureFlagsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureFlagsResp.totalCount).toBe(1);

    // fetching all feature flags
    listFeatureFlagsResp = await client.getFeatureFlags({
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureFlagsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureFlagsResp.totalCount).toBe(2);

    // fetching feature flags from non-existing namespace
    listFeatureFlagsResp = await client.getFeatureFlags({
      // prod1 namespace does not exist
      namespace: 'prod1',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureFlagsResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(listFeatureFlagsResp.response?.details).toBe(`Could not find namespace prod1`);

    await server.close();
  });
});
