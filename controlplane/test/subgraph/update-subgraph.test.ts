import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  createTestRBACEvaluator,
  genID
} from '../../src/core/test-util.js';
import { createEventDrivenGraph, DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';

let dbname = '';

describe('Update subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test.each([
    'organization-admin',
    'organization-developer',
    'subgraph-admin',
  ])('%s should be able to update subgraph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const createFederatedSubgraphResp = await client.updateSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      readme: 'Test readme',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should be able to update subgraph using legacy', async () => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(),
    });

    const createFederatedSubgraphResp = await client.updateSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      readme: 'Test readme',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('subgraph-admin should be able to update subgraph on allowed namespace', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const getNamespaceResponse = await client.getNamespace({ name: DEFAULT_NAMESPACE });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    await createEventDrivenGraph(client, subgraphName);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'subgraph-admin',
        namespaces: [getNamespaceResponse.namespace!.id],
      })),
    });

    let createFederatedSubgraphResp = await client.updateSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      readme: 'Test readme',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'subgraph-admin',
        namespaces: [randomUUID()],
      })),
    });

    createFederatedSubgraphResp = await client.updateSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      readme: 'Test readme',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test.each([
    'organization-apikey-manager',
    'organization-viewer',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-publisher',
    'subgraph-checker',
    'subgraph-viewer',
  ])('%s should not be able to update subgraph', async (role ) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const createFederatedSubgraphResp = await client.updateSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      readme: 'Test readme',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('that an error is returned if an Event-Driven subgraph is updated with a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createEventDrivenGraph(client, subgraphName);
    const createFederatedSubgraphResp = await client.updateSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
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
      namespace: DEFAULT_NAMESPACE,
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
      namespace: DEFAULT_NAMESPACE,
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
      namespace: DEFAULT_NAMESPACE,
      websocketSubprotocol: 1,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('Event-Driven Graphs must not define a websocket subprotocol');

    await server.close();
  });
});
