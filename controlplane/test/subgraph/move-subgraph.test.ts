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

  test('that a subgraph publisher cannot move a subgraph it can only write to', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    // Namespace names must be lowercase, and genID does not guarantee that.
    const targetNamespace = genID('prod').toLowerCase();
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
    const sourceNamespace = namespaces.find((ns) => ns.name === DEFAULT_NAMESPACE);
    const destinationNamespace = namespaces.find((ns) => ns.name === targetNamespace);
    expect(sourceNamespace).toBeDefined();
    expect(destinationNamespace).toBeDefined();

    // The destination grant lets the create check pass, so only the source check can deny the move.
    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(
        createTestGroup(
          { role: 'subgraph-publisher', namespaces: [sourceNamespace!.id] },
          { role: 'subgraph-admin', namespaces: [destinationNamespace!.id] },
        ),
      ),
    });

    const moveResp = await client.moveSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      newNamespace: targetNamespace,
    });
    expect(moveResp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });

  test('that a subgraph admin can move a subgraph between namespaces they administer', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    // Namespace names must be lowercase, and genID does not guarantee that.
    const targetNamespace = genID('prod').toLowerCase();
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
    const sourceNamespace = namespaces.find((ns) => ns.name === DEFAULT_NAMESPACE);
    const destinationNamespace = namespaces.find((ns) => ns.name === targetNamespace);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(
        createTestGroup(
          { role: 'subgraph-admin', namespaces: [sourceNamespace!.id] },
          { role: 'subgraph-admin', namespaces: [destinationNamespace!.id] },
        ),
      ),
    });

    const moveResp = await client.moveSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      newNamespace: targetNamespace,
    });
    expect(moveResp.response?.code).toBe(EnumStatusCode.OK);
  });
});
