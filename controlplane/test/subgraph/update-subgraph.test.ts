import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  createEventDrivenGraph,
  DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_SUBGRAPH_URL_THREE, DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Update subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an error is returned if an Event-Driven subgraph is updated with a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);
    const createFederatedSubgraphResp = await client.updateSubgraph({
      name: subgraphName,
      namespace: 'default',
      routingUrl: '',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('Event-Driven Graphs must not define a routing URL');

    await server.close();
  });

  test('that an error is returned if an Event-Driven subgraph is updated with a subscription URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);
    const createFederatedSubgraphResp = await client.updateSubgraph({
      name: subgraphName,
      namespace: 'default',
      subscriptionUrl: '',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('Event-Driven Graphs must not define a subscription URL');

    await server.close();
  });

  test('that an error is returned if an Event-Driven subgraph is updated with a subscription protocol', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);
    const createFederatedSubgraphResp = await client.updateSubgraph({
      name: subgraphName,
      namespace: 'default',
      subscriptionProtocol: 1,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('Event-Driven Graphs must not define a subscription protocol');

    await server.close();
  });

  test('that an error is returned if an Event-Driven subgraph is updated with a websocket subprotocol', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);
    const createFederatedSubgraphResp = await client.updateSubgraph({
      name: subgraphName,
      namespace: 'default',
      websocketSubprotocol: 1,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('Event-Driven Graphs must not define a websocket subprotocol');

    await server.close();
  });

  test('that an error is returned if a subgraph update is used to attempt to update a feature subgraph', async () => {
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

    const updateSubgraphResponse = await client.updateSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_THREE,
      isFeatureSubgraph: false,
    });
    expect(updateSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(updateSubgraphResponse.response?.details)
      .toBe(`The subgraph "${featureSubgraphName}" is a feature subgraph. Please use the feature-subgraph update command instead.`);

    await server.close();
  });
});
