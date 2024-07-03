import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  createFeatureFlag,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Update feature flag tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature flag can be updated', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName])

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that a feature flag can be updated with another feature subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const featureFlagName = genID('flag');
    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName])

    const subgraphNameTwo = genID('subgraph');
    const featureSubgraphNameTwo = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphNameTwo, featureSubgraphNameTwo, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName, featureSubgraphNameTwo],
    });

    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that an error is returned if a feature flag that does not exist is updated', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const featureFlagName = genID('flag');

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(updateFeatureFlagResponse.response?.details)
      .toBe(`The feature flag "${featureFlagName}" does not exist in the namespace "default".`);

    await server.close();
  });

  test('that an error is returned if a feature flag is updated to contain duplicate feature subgraphs', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_TWO);

    const featureFlagName = genID('flag');

    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphName, featureSubgraphName],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(updateFeatureFlagResponse.response?.details)
      .toBe('1. Feature subgraphs with the same base subgraph cannot compose the same feature flag.');

    await server.close();
  });

  test('that an error is returned if a feature flag is updated to contain feature subgraphs that share the same base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphNameOne = genID('featureSubgraphOne');
    const featureSubgraphNameTwo = genID('featureSubgraphTwo');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_TWO);

    const featureFlagName = genID('flag');

    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphNameOne]);

    const createFeatureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphNameTwo,
      routingUrl: 'http://localhost:4004',
      baseSubgraphName: subgraphName,
      isFeatureSubgraph: true,
    });
    expect(createFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [featureSubgraphNameOne, featureSubgraphNameTwo],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(updateFeatureFlagResponse.response?.details)
      .toBe('1. Feature subgraphs with the same base subgraph cannot compose the same feature flag.');

    await server.close();
  });

  test('that an error is returned if a feature flag is updated to contain a base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_TWO);

    const featureFlagName = genID('flag');

    await createFeatureFlag(client, featureFlagName, [], [featureSubgraphName]);

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      name: featureFlagName,
      featureSubgraphNames: [subgraphName],
    });
    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(updateFeatureFlagResponse.response?.details)
      .toBe(`1. The subgraph "${subgraphName}" is not a feature subgraph.`);

    await server.close();
  });
});
