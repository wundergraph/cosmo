import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID
} from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  createNamespace,
  createSubgraph, DEFAULT_NAMESPACE,
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

  test('that an error is returned if a non-extant feature subgraph is updated', async () => {
    const { client, server } = await SetupTest({ dbname });

    const featureSubgraphName = genID('featureSubgraphName');

    const createFederatedSubgraphResp = await client.updateSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
    });
    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(createFederatedSubgraphResp.response?.details).toBe(`The subgraph "${featureSubgraphName}" was not found.`);

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
    });
    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(createFederatedSubgraphResp.response?.details).toBe(`The subgraph "${featureSubgraphName}" was not found.`);

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
      labels: [],
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.OK);

    const featureSubgraphResponseTwo = await client.updateSubgraph({
      name: featureSubgraphName,
      labels: [{ key: 'hello', value: 'world' }],
    });
    expect(featureSubgraphResponseTwo.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureSubgraphResponseTwo.response?.details)
      .toBe(`Feature subgraph labels cannot be changed directly. Feature subgraph labels are determined by the feature flag they compose.`);

    const featureSubgraphResponseThree = await client.updateSubgraph({
      name: featureSubgraphName,
      unsetLabels: true,
    });
    expect(featureSubgraphResponseThree.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureSubgraphResponseThree.response?.details)
      .toBe(`Feature subgraph labels cannot be changed directly. Feature subgraph labels are determined by the feature flag they compose.`);

    await server.close();
  });

  test.each([
    'organization-admin',
    'organization-developer',
    'subgraph-admin',
  ])('%s should be able to update feature subgraph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const baseSubgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(
      client,
      baseSubgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const featureSubgraphResponse = await client.updateSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_THREE,
    });
    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const getSubgraphResponse = await client.getSubgraphByName({ name: featureSubgraphName });
    expect(getSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_THREE);

    await server.close();
  });

  test('subgraph-admin should be able to update feature subgraph from allowed namespaces', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const baseSubgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    const getNamespaceResponse = await client.getNamespace({ name: DEFAULT_NAMESPACE });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    await createBaseAndFeatureSubgraph(
      client,
      baseSubgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'subgraph-admin',
        namespaces: [getNamespaceResponse.namespace!.id],
      })),
    });

    const featureSubgraphResponse = await client.updateSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_THREE,
    });
    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const getSubgraphResponse = await client.getSubgraphByName({ name: featureSubgraphName });
    expect(getSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_THREE);

    await server.close();
  });

  test('subgraph-admin should be able to update allowed feature subgraph', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const baseSubgraphName = genID('subgraph');
    const baseSubgraphName2 = genID('subgraph2');
    const featureSubgraphName = genID('featureSubgraph');
    const featureSubgraphName2 = genID('featureSubgraph2');

    await createBaseAndFeatureSubgraph(
      client,
      baseSubgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createBaseAndFeatureSubgraph(
      client,
      baseSubgraphName2,
      featureSubgraphName2,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const getFeatureSubgraphsResponse = await client.getFeatureSubgraphs({});
    expect(getFeatureSubgraphsResponse.response?.code).toBe(EnumStatusCode.OK);

    const featureSubgraph = getFeatureSubgraphsResponse.featureSubgraphs?.find((g) => g.name === featureSubgraphName);
    expect(featureSubgraph).toBeDefined();

    const featureSubgraph2 = getFeatureSubgraphsResponse.featureSubgraphs?.find((g) => g.name === featureSubgraphName2);
    expect(featureSubgraph2).toBeDefined();

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'subgraph-admin',
        resources: [featureSubgraph!.targetId],
      })),
    });

    let featureSubgraphResponse = await client.updateSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_THREE,
    });
    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const getSubgraphResponse = await client.getSubgraphByName({ name: featureSubgraphName });
    expect(getSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_THREE);

    featureSubgraphResponse = await client.updateSubgraph({
      name: featureSubgraphName2,
      routingUrl: DEFAULT_SUBGRAPH_URL_THREE,
    });
    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

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
    'subgraph-viewer',
  ])('%s should not be able to update feature subgraph from allowed namespaces', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });

    const baseSubgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    const getNamespaceResponse = await client.getNamespace({ name: DEFAULT_NAMESPACE });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    await createBaseAndFeatureSubgraph(
      client,
      baseSubgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const featureSubgraphResponse = await client.updateSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_THREE,
    });
    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });
});
