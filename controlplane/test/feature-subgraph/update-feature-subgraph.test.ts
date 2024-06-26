import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  createNamespace,
  createSubgraph,
  DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_THREE, DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Update feature subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature subgraph can be updated', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const featureSubgraphResponse = await client.updateSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_THREE,
      isFeatureSubgraph: true,
    });
    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const getSubgraphResponse = await client.getSubgraphByName({ name: featureSubgraphName });
    expect(getSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_THREE);

    await server.close();
  });

  test('that an error is returned if a non-extant feature subgraph is updated', async () => {
    const { client, server } = await SetupTest({ dbname });

    const featureSubgraphName = genID('featureSubgraphName');

    const createFederatedSubgraphResp = await client.updateSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
    });
    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(createFederatedSubgraphResp.response?.details).toBe(`The feature subgraph "${featureSubgraphName}" was not found.`);

    await server.close();
  });

  test('that an error is returned when attempting to update a feature flag in a different namespace', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
      namespace,
    );

    const createFederatedSubgraphResp = await client.updateSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_THREE,
      isFeatureSubgraph: true,
    });
    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(createFederatedSubgraphResp.response?.details).toBe(`The feature subgraph "${featureSubgraphName}" was not found.`);

    await server.close();
  });

  test('that an error is returned when attempting to update a feature subgraph with labels', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    // Undefined labels are defaulted to an empty array
    const featureSubgraphResponseOne = await client.updateSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      labels: [],
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.OK);

    const featureSubgraphResponseTwo = await client.updateSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      labels: [{ key: 'hello', value: 'world' }],
    });
    expect(featureSubgraphResponseTwo.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureSubgraphResponseTwo.response?.details)
      .toBe(`Feature subgraph labels cannot be changed directly; they are determined by the feature flag.`);

    const featureSubgraphResponseThree = await client.updateSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      unsetLabels: true,
    });
    expect(featureSubgraphResponseThree.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureSubgraphResponseThree.response?.details)
      .toBe(`Feature subgraph labels cannot be changed directly; they are determined by the feature flag.`);

    await server.close();
  });
});
