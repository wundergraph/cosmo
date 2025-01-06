import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  createSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Create subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an Event-Driven subgraph can be created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that a regular subgraph can be created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

    test('that an error is returned if the name is invalid', async () => {
      const { client, server } = await SetupTest({ dbname });

      let createFederatedSubgraphResp = await client.createFederatedSubgraph({
        name: "a*a",
        namespace: DEFAULT_NAMESPACE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      });

      expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

      createFederatedSubgraphResp = await client.createFederatedSubgraph({
        name: "a*a/",
        namespace: DEFAULT_NAMESPACE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      });

      expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

      createFederatedSubgraphResp = await client.createFederatedSubgraph({
        name: "^a*a/",
        namespace: DEFAULT_NAMESPACE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      });

      expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

      createFederatedSubgraphResp = await client.createFederatedSubgraph({
        name: "Test".repeat(26),
        namespace: DEFAULT_NAMESPACE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      });

      expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);

      await server.close();
    });

  test('that an error is returned if an Event-Driven subgraph defines a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
      routingUrl: '',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a routing URL');

    await server.close();
  });

  test('that an error is returned if an Event-Driven subgraph defines a subscription URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
      subscriptionUrl: '',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a subscription URL');

    await server.close();
  });

  test('that an error is returned if an Event-Driven subgraph defines a subscription protocol', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
      subscriptionProtocol: 1,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a subscription protocol');

    await server.close();
  });

  test('that an error is returned if an Event-Driven subgraph defines a websocket subprotocol', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      isEventDrivenGraph: true,
      websocketSubprotocol: 1,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a websocket subprotocol');

    await server.close();
  });

  test('that a valid subscription URL is accepted', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      subscriptionUrl: 'ws://whatever.co',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that an error is returned if an invalid subscription URL is defined', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      subscriptionUrl: 'url',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('Subscription URL "url" is not a valid URL');

    await server.close();
  });

  test('that an error is returned if a regular subgraph is created without a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('A non-Event-Driven Graph must define a routing URL');

    await server.close();
  });

  test('that an error is returned if a regular subgraph is created with an invalid routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: 'url',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('Routing URL "url" is not a valid URL');

    await server.close();
  });

  test('that an error is returned if a subgraph is created with the same name as another feature subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const createSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: false,
    });
    expect(createSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(createSubgraphResponse.response?.details)
      .toBe(`A feature subgraph with the name "${featureSubgraphName}" already exists in the namespace "default".`);

    await server.close();
  });
});
