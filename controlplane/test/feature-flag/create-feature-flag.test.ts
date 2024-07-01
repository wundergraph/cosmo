import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  createNamespace,
  createSubgraph,
  DEFAULT_SUBGRAPH_URL_ONE,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Create feature flag tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature flag can be created with a feature subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that an error is returned if a feature flag is created without any feature subgraphs', async () => {
    const { client, server } = await SetupTest({ dbname });

    const flagName = genID('flag');
    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureFlagResponse.response?.details)
      .toBe('At least one feature subgraph is required to create a feature flag.');

    await server.close();
  });

  test('that an error is returned if a duplicate feature flag is created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const featureFlagResponseTwo = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(featureFlagResponseTwo.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(featureFlagResponseTwo.response?.details)
      .toBe(`The feature flag "${flagName}" already exists in the namespace "default".`);

    await server.close();
  });

  test('that an error is returned if a feature subgraph cannot be found when creating a feature flag', async () => {
    const { client, server } = await SetupTest({ dbname });

    const featureSubgraphName = genID('featureSubgraph');
    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(featureFlagResponse.response?.details)
      .toBe(`The feature subgraph "${featureSubgraphName}" was not found.\n`);

    await server.close();
  });

  test('that an error is returned if a non-feature subgraph is used to create a feature flag', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      featureSubgraphNames: [subgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(featureFlagResponse.response?.details)
      .toBe(`The feature subgraph "${subgraphName}" was not found.\n`);

    await server.close();
  });

  test('that an error is returned if the feature subgraph does not exist in the same namespace as the feature flag', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(client, subgraphName, featureSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, 'http://localhost:4002');

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);

    const flagName = genID('flag');

    const featureFlagResponse = await client.createFeatureFlag({
      name: flagName,
      namespace,
      featureSubgraphNames: [featureSubgraphName],
    });

    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(featureFlagResponse.response?.details)
      .toBe(`The feature subgraph "${featureSubgraphName}" was not found.\n`);

    await server.close();
  });
});
