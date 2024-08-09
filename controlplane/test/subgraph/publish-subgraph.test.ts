import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import { createEventDrivenGraph, createSubgraph, eventDrivenGraphSDL, SetupTest, subgraphSDL } from '../test-util.js';

let dbname = '';

describe('Publish subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an Event-Driven Graph can be published after it has already been created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);
    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that a regular subgraph can be published after it has already been created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createSubgraph(client, subgraphName, 'http://localhost:4001');
    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: subgraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that an error is returned if a regular subgraph is published when the graph was created as an EDG', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);
    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: subgraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe(
      'The subgraph was originally created as an Event-Driven Graph (EDG).' +
      ' An EDG cannot be retroactively changed into a regular subgraph. Please create a new regular subgraph.',
    );

    await server.close();
  });

  test('that an error is returned if an EDG is published when the graph was created as a regular subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createSubgraph(client, subgraphName, 'http://localhost:4001');
    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe(
      'The subgraph was originally created as a regular subgraph.' +
      ' A regular subgraph cannot be retroactively changed into an Event-Driven Graph (EDG).' +
      ' Please create a new Event-Driven subgraph with the --edg flag.',
    );

    await server.close();
  });

  test('that parameters are ignored if an Event-Driven Graph is published after it has already been created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);
    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
      routingUrl: '',
      subscriptionUrl: '',
      subscriptionProtocol: 1,
      websocketSubprotocol: 1,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that an Event-Driven Graph can be published without already being created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that a regular subgraph can be published without already being created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: subgraphSDL,
      routingUrl: 'http://localhost:4001',
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('that an error is returned if a previously uncreated Event-Driven Graph is published with a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
      routingUrl: '',
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a routing URL');

    await server.close();
  });

  test('that an error is returned if a previously uncreated Event-Driven Graph is published with a subscription URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
      subscriptionUrl: '',
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a subscription URL');

    await server.close();
  });

  test('that an error is returned if a previously uncreated Event-Driven Graph is published with a subscription protocol', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
      subscriptionProtocol: 1,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a subscription protocol');

    await server.close();
  });

  test('that an error is returned if a previously uncreated Event-Driven Graph is published with a websocket subprotocol', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: eventDrivenGraphSDL,
      websocketSubprotocol: 1,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe('An Event-Driven Graph must not define a websocket subprotocol.');

    await server.close();
  });

  test('that an error is returned if a previously uncreated subgraph is published without a routing url', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: subgraphSDL,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details)
      .toBe('A valid, non-empty routing URL is required to create and publish a non-Event-Driven subgraph.');

    await server.close();
  });

  test('that an error is returned if a previously uncreated subgraph is published with an invalid routing url', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: subgraphSDL,
      routingUrl: 'url'
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(publishFederatedSubgraphResp.response?.details).toBe('Routing URL "url" is not a valid URL.');

    await server.close();
  });
});
