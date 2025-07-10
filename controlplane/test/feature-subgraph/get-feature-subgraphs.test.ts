import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestRBACEvaluator,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  genID
} from '../../src/core/test-util.js';
import {
    DEFAULT_SUBGRAPH_URL_ONE,
    DEFAULT_SUBGRAPH_URL_TWO,
    SetupTest,
    createBaseAndFeatureSubgraph,
} from '../test-util.js';

let dbname = '';

describe('List feature subgraphs', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to list feature subgraphs of different namespace', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const flagName = genID('flag');

    const createNamespaceResp = await client.createNamespace({
      name: 'prod',
    });

    expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
      'prod',
    );

    // fetching feature subgraphs from default namespace
    let listFeatureSubgraphsResp = await client.getFeatureSubgraphs({
      namespace: 'default',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureSubgraphsResp.count).toBe(1);

    // fetching feature subgraphs from prod namespace
    listFeatureSubgraphsResp = await client.getFeatureSubgraphs({
      namespace: 'prod',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureSubgraphsResp.count).toBe(1);

    // fetching all feature subgraphs
    listFeatureSubgraphsResp = await client.getFeatureSubgraphs({
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureSubgraphsResp.count).toBe(2);

    // fetching feature subgraphs from non-existing namespace
    listFeatureSubgraphsResp = await client.getFeatureSubgraphs({
      // prod1 namespace does not exist
      namespace: 'prod1',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureSubgraphsResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(listFeatureSubgraphsResp.response?.details).toBe(`Could not find namespace prod1`);

    await server.close();
  });

  test('Should be able to list feature subgraphs of different namespace when using legacy API key', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const flagName = genID('flag');

    const createNamespaceResp = await client.createNamespace({
      name: 'prod',
    });

    expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
      'prod',
    );

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(),
    });

    // fetching feature subgraphs from default namespace
    let listFeatureSubgraphsResp = await client.getFeatureSubgraphs({
      namespace: 'default',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureSubgraphsResp.count).toBe(1);

    // fetching feature subgraphs from prod namespace
    listFeatureSubgraphsResp = await client.getFeatureSubgraphs({
      namespace: 'prod',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureSubgraphsResp.count).toBe(1);

    // fetching all feature subgraphs
    listFeatureSubgraphsResp = await client.getFeatureSubgraphs({
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureSubgraphsResp.count).toBe(2);

    // fetching feature subgraphs from non-existing namespace
    listFeatureSubgraphsResp = await client.getFeatureSubgraphs({
      // prod1 namespace does not exist
      namespace: 'prod1',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureSubgraphsResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(listFeatureSubgraphsResp.response?.details).toBe(`Could not find namespace prod1`);

    await server.close();
  });

  test.each([
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s should be able to list feature subgraphs from allowed namespaces', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');
    const flagName = genID('flag');

    const createNamespaceResp = await client.createNamespace({
      name: 'prod',
    });

    expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

    const getNamespaceResponse = await client.getNamespace({ name: 'prod' });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
      'prod',
    );

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role,
        namespaces: [getNamespaceResponse.namespace!.id],
      })),
    });

    // fetching feature subgraphs from default namespace
    let listFeatureSubgraphsResp = await client.getFeatureSubgraphs({
      namespace: 'default',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureSubgraphsResp.count).toBe(0);

    // fetching feature subgraphs from prod namespace
    listFeatureSubgraphsResp = await client.getFeatureSubgraphs({
      namespace: 'prod',
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureSubgraphsResp.count).toBe(1);

    // fetching all feature subgraphs
    listFeatureSubgraphsResp = await client.getFeatureSubgraphs({
      offset: 0,
      // fetches all
      limit: 0,
    });

    expect(listFeatureSubgraphsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(listFeatureSubgraphsResp.count).toBe(1);

    await server.close();
  });
});
