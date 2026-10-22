import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Move subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a subgraph that forms the base of a feature subgraph cannot be moved', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const moveSubgraphResponse = await client.moveSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      newNamespace: 'prod',
    });
    expect(moveSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(moveSubgraphResponse.response?.details).toBe(
      'Subgraphs that form the base of one or more feature subgraphs cannot be moved.',
    );
  });

  test('that a user cannot move a subgraph into a namespace they cannot create subgraphs in', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const targetNamespace = 'restricted';
    await client.createNamespace({ name: targetNamespace });

    const subgraphName = genID('subgraph');
    const createResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      labels: [],
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    const { namespaces } = await client.getNamespaces({});
    const defaultNamespace = namespaces.find((ns) => ns.name === DEFAULT_NAMESPACE);
    expect(defaultNamespace).toBeDefined();

    // Can write to the source namespace but has no rights in the destination.
    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role: 'subgraph-admin', namespaces: [defaultNamespace!.id] })),
    });

    const moveResp = await client.moveSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      newNamespace: targetNamespace,
    });
    expect(moveResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });
});
