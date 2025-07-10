import fs from 'node:fs';
import { join } from 'node:path';
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
  createSubgraph,
  createThenPublishFeatureSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Delete feature subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an error is returned if a non-extant feature-graph is attempted to be deleted', async () => {
    const { client, server } = await SetupTest({ dbname });

    const featureSubgraphName = genID('nonExtantFeatureSubgraph');

    const deleteFederatedSubgraphResponse = await client.deleteFederatedSubgraph({
      subgraphName: featureSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    })
    expect(deleteFederatedSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(deleteFederatedSubgraphResponse.response?.details)
      .toBe(`The subgraph "${featureSubgraphName}" was not found.`);

    await server.close();
  });

  test('that a feature subgraph that has been published can be deleted', async () => {
    const { client, server } = await SetupTest({ dbname });

    const baseSubgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createSubgraph(
      client,
      baseSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphName,
      baseSubgraphName,
      DEFAULT_NAMESPACE,
      fs.readFileSync(join(process.cwd(),`test/test-data/feature-flags/products-feature.graphql`)).toString(),
      [],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const deleteFederatedSubgraphResponse = await client.deleteFederatedSubgraph({
      subgraphName: featureSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    })
    expect(deleteFederatedSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Expect the feature subgraph to no longer exist
    const getFeatureSubgraphByNameResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureSubgraphByNameResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    // Expect the base subgraph to still exist
    const getSubgraphByNameResponse = await client.getSubgraphByName({
      name: baseSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getSubgraphByNameResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test.each([
    'organization-admin',
    'organization-developer',
    'subgraph-admin',
  ])('%s should be able to delete feature subgraph', async (role) => {
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

    const deleteFederatedSubgraphResponse = await client.deleteFederatedSubgraph({
      subgraphName: featureSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    })
    expect(deleteFederatedSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Expect the feature subgraph to no longer exist
    const getFeatureSubgraphByNameResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureSubgraphByNameResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    // Expect the base subgraph to still exist
    const getSubgraphByNameResponse = await client.getSubgraphByName({
      name: baseSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getSubgraphByNameResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('subgraph-admin should be able to delete feature subgraph from allowed namespace', async (role) => {
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

    const getNamespaceResponse = await client.getNamespace({ name: DEFAULT_NAMESPACE });
    expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({
        role: 'subgraph-admin',
        namespaces: [getNamespaceResponse.namespace!.id],
      })),
    });

    const deleteFederatedSubgraphResponse = await client.deleteFederatedSubgraph({
      subgraphName: featureSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    })
    expect(deleteFederatedSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Expect the feature subgraph to no longer exist
    const getFeatureSubgraphByNameResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getFeatureSubgraphByNameResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    // Expect the base subgraph to still exist
    const getSubgraphByNameResponse = await client.getSubgraphByName({
      name: baseSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getSubgraphByNameResponse.response?.code).toBe(EnumStatusCode.OK);

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
  ])('%s should not be able to delete feature subgraph', async (role) => {
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

    const deleteFederatedSubgraphResponse = await client.deleteFederatedSubgraph({
      subgraphName: featureSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    })
    expect(deleteFederatedSubgraphResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });
});
