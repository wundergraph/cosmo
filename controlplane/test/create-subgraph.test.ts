import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

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
      namespace: 'default',
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
      namespace: 'default',
      routingUrl: 'http://localhost:4001',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that an error is returned if an Event-Driven subgraph defines a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
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
      namespace: 'default',
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
      namespace: 'default',
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
      namespace: 'default',
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
      namespace: 'default',
      routingUrl: 'http://localhost:4001',
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
      namespace: 'default',
      routingUrl: 'http://localhost:4001',
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
      namespace: 'default',
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
      namespace: 'default',
      routingUrl: 'url',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('Routing URL "url" is not a valid URL');

    await server.close();
  });
});
