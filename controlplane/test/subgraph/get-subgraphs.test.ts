import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator, createTestGroup, createTestRBACEvaluator,
  genID,
  genUniqueLabel
} from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';

let dbname = '';

describe('List Subgraphs', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to list subgraphs of different namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();

    const createNamespaceResp = await client.createNamespace({
      name: 'prod',
    });

    expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

    // creating the subgraphs in default namespace
    let createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // creating the subgraph in prod namespace
    createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'prod',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // fetching subgraphs from default namespace
    let listSubgraphsResp = await client.getSubgraphs({
      namespace: 'default',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listSubgraphsResp.count).toBe(1);

    // fetching subgraphs from prod namespace
    listSubgraphsResp = await client.getSubgraphs({
      namespace: 'prod',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listSubgraphsResp.count).toBe(1);


    // fetching all subgraphs
    listSubgraphsResp = await client.getSubgraphs({
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listSubgraphsResp.count).toBe(2);

    // fetching subgraphs from non-existing namespace
    listSubgraphsResp = await client.getSubgraphs({
      // prod1 namespace does not exist
      namespace: 'prod1',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listSubgraphsResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(listSubgraphsResp.response?.details).toBe(`Could not find namespace prod1`);

    await server.close();
  });

  test('Should be able to list subgraphs of different namespace when using legacy API key', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();

    const createNamespaceResp = await client.createNamespace({
      name: 'prod',
    });

    expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

    // creating the subgraphs in default namespace
    let createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // creating the subgraph in prod namespace
    createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'prod',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(),
    });

    // fetching subgraphs from default namespace
    let listSubgraphsResp = await client.getSubgraphs({
      namespace: 'default',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listSubgraphsResp.count).toBe(1);

    // fetching subgraphs from prod namespace
    listSubgraphsResp = await client.getSubgraphs({
      namespace: 'prod',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listSubgraphsResp.count).toBe(1);


    // fetching all subgraphs
    listSubgraphsResp = await client.getSubgraphs({
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listSubgraphsResp.count).toBe(2);

    // fetching subgraphs from non-existing namespace
    listSubgraphsResp = await client.getSubgraphs({
      // prod1 namespace does not exist
      namespace: 'prod1',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listSubgraphsResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(listSubgraphsResp.response?.details).toBe(`Could not find namespace prod1`);

    await server.close();
  });

  test.each([
    'subgraph-admin',
    'subgraph-publisher',
  ])('%s should be able to list subgraphs from allowed namespaces', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();

    const createNamespaceResp = await client.createNamespace({
      name: 'prod',
    });

    expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

    const getNamespaceResponse = await client.getNamespace({ name: 'prod' });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    // creating the subgraphs in default namespace
    let createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // creating the subgraph in prod namespace
    createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'prod',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role,
        namespaces: [getNamespaceResponse.namespace!.id],
      })),
    });

    // fetching subgraphs from default namespace
    let listSubgraphsResp = await client.getSubgraphs({
      namespace: 'default',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listSubgraphsResp.count).toBe(0);

    // fetching subgraphs from prod namespace
    listSubgraphsResp = await client.getSubgraphs({
      namespace: 'prod',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listSubgraphsResp.count).toBe(1);


    // fetching all subgraphs
    listSubgraphsResp = await client.getSubgraphs({
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listSubgraphsResp.count).toBe(1);

    await server.close();
  });
});
