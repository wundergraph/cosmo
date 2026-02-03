import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SubgraphType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
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

  describe('GRPC Service subgraph update tests', () => {
    test('Should not allow updating a GRPC service subgraph with HTTP/HTTPS routing URL', async () => {
      const { client, server } = await SetupTest({ dbname });

      const grpcServiceName = genID('grpc-service');
      const grpcServiceLabel = genUniqueLabel('grpc-service');

      // First create a GRPC service subgraph with valid gRPC naming scheme
      const createResp = await client.createFederatedSubgraph({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl: 'dns:localhost:8080',
        labels: [grpcServiceLabel],
      });

      expect(createResp.response?.code).toBe(EnumStatusCode.OK);

      // Try to update with HTTP URL
      const updateResponseHttp = await client.updateSubgraph({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
        routingUrl: 'http://localhost:8080',
      });

      expect(updateResponseHttp.response?.code).toBe(EnumStatusCode.ERR);
      expect(updateResponseHttp.response?.details).toContain('Routing URL must follow gRPC naming scheme');

      // Try to update with HTTPS URL
      const updateResponseHttps = await client.updateSubgraph({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
        routingUrl: 'https://example.com:8080',
      });

      expect(updateResponseHttps.response?.code).toBe(EnumStatusCode.ERR);
      expect(updateResponseHttps.response?.details).toContain('Routing URL must follow gRPC naming scheme');

      await server.close();
    });

    test('Should allow updating a GRPC service subgraph with valid gRPC naming scheme URLs', async () => {
      const { client, server } = await SetupTest({ dbname });

      const grpcServiceName = genID('grpc-service');
      const grpcServiceLabel = genUniqueLabel('grpc-service');

      // First create a GRPC service subgraph
      const createResp = await client.createFederatedSubgraph({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_SERVICE,
        routingUrl: 'dns:localhost:8080',
        labels: [grpcServiceLabel],
      });

      expect(createResp.response?.code).toBe(EnumStatusCode.OK);

      // Update with DNS scheme
      const updateResponseDns = await client.updateSubgraph({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
        routingUrl: 'dns:example.com:9090',
      });

      expect(updateResponseDns.response?.code).toBe(EnumStatusCode.OK);

      // Update with plain hostname (defaults to DNS)
      const updateResponsePlain = await client.updateSubgraph({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
        routingUrl: 'localhost:9090',
      });

      expect(updateResponsePlain.response?.code).toBe(EnumStatusCode.OK);

      // Update with IPv4 scheme
      const updateResponseIpv4 = await client.updateSubgraph({
        name: grpcServiceName,
        namespace: DEFAULT_NAMESPACE,
        routingUrl: 'ipv4:127.0.0.1:9090',
      });

      expect(updateResponseIpv4.response?.code).toBe(EnumStatusCode.OK);

      await server.close();
    });
  });
});
