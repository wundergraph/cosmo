import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
  TestUser,
} from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  createNamespace,
  createSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';
import { OrganizationRole } from '../../src/db/models.js';

let dbname = '';

describe('Link/Unlink Subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  describe('LinkSubgraph', () => {
    test('Should successfully link two subgraphs in different namespaces', async () => {
      const { client, server } = await SetupTest({ dbname });

      // Create two namespaces
      await createNamespace(client, 'prod');

      const sourceSubgraphName = genID('source-subgraph');
      const targetSubgraphName = genID('target-subgraph');
      const sourceLabel = genUniqueLabel('source');
      const targetLabel = genUniqueLabel('target');

      // Create source subgraph in default namespace
      const createSourceSubgraphResp = await client.createFederatedSubgraph({
        name: sourceSubgraphName,
        namespace: DEFAULT_NAMESPACE,
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
        labels: [sourceLabel],
      });
      expect(createSourceSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Create target subgraph in prod namespace
      const createTargetSubgraphResp = await client.createFederatedSubgraph({
        name: targetSubgraphName,
        namespace: 'prod',
        routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
        labels: [targetLabel],
      });
      expect(createTargetSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Link the subgraphs
      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName,
        targetSubgraphNamespace: 'prod',
      });

      expect(linkResponse.response?.code).toBe(EnumStatusCode.OK);

      await server.close();
    });

    test('Should fail when source namespace does not exist', async () => {
      const { client, server } = await SetupTest({ dbname });

      await createNamespace(client, 'prod');
      const targetSubgraphName = genID('target-subgraph');
      await createSubgraph(client, targetSubgraphName, DEFAULT_SUBGRAPH_URL_TWO, 'prod');

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName: 'any-subgraph',
        sourceSubgraphNamespace: 'nonexistent',
        targetSubgraphName,
        targetSubgraphNamespace: 'prod',
      });

      expect(linkResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(linkResponse.response?.details).toBe('The source namespace "nonexistent" was not found.');

      await server.close();
    });

    test('Should fail when target namespace does not exist', async () => {
      const { client, server } = await SetupTest({ dbname });

      const sourceSubgraphName = genID('source-subgraph');
      await createSubgraph(client, sourceSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName: 'any-subgraph',
        targetSubgraphNamespace: 'nonexistent',
      });

      expect(linkResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(linkResponse.response?.details).toBe('The target namespace "nonexistent" was not found.');

      await server.close();
    });

    test('Should fail when source subgraph does not exist', async () => {
      const { client, server } = await SetupTest({ dbname });

      await createNamespace(client, 'prod');
      const targetSubgraphName = genID('target-subgraph');
      await createSubgraph(client, targetSubgraphName, DEFAULT_SUBGRAPH_URL_TWO, 'prod');

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName: 'nonexistent-subgraph',
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName,
        targetSubgraphNamespace: 'prod',
      });

      expect(linkResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(linkResponse.response?.details).toBe('The subgraph "nonexistent-subgraph" was not found.');

      await server.close();
    });

    test('Should fail when target subgraph does not exist', async () => {
      const { client, server } = await SetupTest({ dbname });

      await createNamespace(client, 'prod');
      const sourceSubgraphName = genID('source-subgraph');
      await createSubgraph(client, sourceSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName: 'nonexistent-subgraph',
        targetSubgraphNamespace: 'prod',
      });

      expect(linkResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(linkResponse.response?.details).toBe('The target subgraph "nonexistent-subgraph" was not found.');

      await server.close();
    });

    test('Should fail when source and target subgraphs are the same', async () => {
      const { client, server } = await SetupTest({ dbname });

      const sourceSubgraphName = genID('source-subgraph');

      // Create both subgraphs in the same namespace
      await createSubgraph(client, sourceSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName: sourceSubgraphName,
        targetSubgraphNamespace: DEFAULT_NAMESPACE,
      });

      expect(linkResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(linkResponse.response?.details).toBe('The source and target subgraphs cannot be the same subgraphs.');

      await server.close();
    });

    test('Should fail when source subgraph is a feature subgraph', async () => {
      const { client, server } = await SetupTest({ dbname });

      await createNamespace(client, 'prod');
      const baseSubgraphName = genID('base-subgraph');
      const featureSubgraphName = genID('feature-subgraph');
      const targetSubgraphName = genID('target-subgraph');

      // Create base and feature subgraph
      await createBaseAndFeatureSubgraph(
        client,
        baseSubgraphName,
        featureSubgraphName,
        DEFAULT_SUBGRAPH_URL_ONE,
        DEFAULT_SUBGRAPH_URL_TWO,
      );

      // Create target subgraph in prod namespace
      await createSubgraph(client, targetSubgraphName, 'http://localhost:4003', 'prod');

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName: featureSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName,
        targetSubgraphNamespace: 'prod',
      });

      expect(linkResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(linkResponse.response?.details).toBe(
        `The source subgraph "${featureSubgraphName}" is a feature subgraph. Feature subgraphs can not be linked.`,
      );

      await server.close();
    });

    test('Should fail when target subgraph is a feature subgraph', async () => {
      const { client, server } = await SetupTest({ dbname });

      await createNamespace(client, 'prod');
      const baseSubgraphName = genID('base-subgraph');
      const featureSubgraphName = genID('feature-subgraph');
      const sourceSubgraphName = genID('source-subgraph');

      // Create base and feature subgraph in prod namespace
      const createBaseSubgraphResp = await client.createFederatedSubgraph({
        name: baseSubgraphName,
        namespace: 'prod',
        routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
        labels: [genUniqueLabel('base')],
      });
      expect(createBaseSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      const createFeatureSubgraphResp = await client.createFederatedSubgraph({
        name: featureSubgraphName,
        namespace: 'prod',
        routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
        isFeatureSubgraph: true,
        baseSubgraphName,
      });
      expect(createFeatureSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

      // Create source subgraph in default namespace
      await createSubgraph(client, sourceSubgraphName, 'http://localhost:4003', DEFAULT_NAMESPACE);

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName: featureSubgraphName,
        targetSubgraphNamespace: 'prod',
      });

      expect(linkResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(linkResponse.response?.details).toBe(
        `The target subgraph "${featureSubgraphName}" is a feature subgraph. Feature subgraphs can not be linked.`,
      );

      await server.close();
    });

    test('Should fail when source subgraph is already linked to another subgraph', async () => {
      const { client, server } = await SetupTest({ dbname });

      await createNamespace(client, 'prod');
      await createNamespace(client, 'staging');

      const sourceSubgraphName = genID('source-subgraph');
      const firstTargetName = genID('first-target');
      const secondTargetName = genID('second-target');

      // Create all subgraphs
      await createSubgraph(client, sourceSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);
      await createSubgraph(client, firstTargetName, DEFAULT_SUBGRAPH_URL_TWO, 'prod');
      await createSubgraph(client, secondTargetName, 'http://localhost:4003', 'staging');

      // First link should succeed
      const firstLinkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName: firstTargetName,
        targetSubgraphNamespace: 'prod',
      });
      expect(firstLinkResponse.response?.code).toBe(EnumStatusCode.OK);

      // Second link should fail
      const secondLinkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName: secondTargetName,
        targetSubgraphNamespace: 'staging',
      });

      expect(secondLinkResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(secondLinkResponse.response?.details).toBe(
        `The source subgraph "${sourceSubgraphName}" is already linked to the target subgraph "${firstTargetName}" in the namespace "prod". Unlink the existing link first.`,
      );

      await server.close();
    });

    test('Should fail when user lacks write access to source subgraph', async () => {
      const { client, server, users, authenticator } = await SetupTest({
        dbname,
        enableMultiUsers: true,
        enabledFeatures: ['rbac'],
      });

      await createNamespace(client, 'prod');
      const sourceSubgraphName = genID('source-subgraph');
      const targetSubgraphName = genID('target-subgraph');

      // Create subgraphs as admin
      await createSubgraph(client, sourceSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);
      await createSubgraph(client, targetSubgraphName, DEFAULT_SUBGRAPH_URL_TWO, 'prod');

      // Switch to user without write permissions
      authenticator.changeUserWithSuppliedContext({
        ...users[TestUser.adminAliceCompanyA],
        rbac: createTestRBACEvaluator(createTestGroup({ role: 'subgraph-viewer' as OrganizationRole })),
      });

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName,
        targetSubgraphNamespace: 'prod',
      });

      expect(linkResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      await server.close();
    });

    test('Should fail when user lacks read access to target subgraph', async () => {
      const { client, server, users, authenticator } = await SetupTest({
        dbname,
        enableMultiUsers: true,
        enabledFeatures: ['rbac'],
      });

      await createNamespace(client, 'prod');
      const sourceSubgraphName = genID('source-subgraph');
      const targetSubgraphName = genID('target-subgraph');

      // Get namespace IDs
      const getNamespacesResp = await client.getNamespaces({});
      const defaultNamespace = getNamespacesResp.namespaces?.find((ns) => ns.name === DEFAULT_NAMESPACE);
      const prodNamespace = getNamespacesResp.namespaces?.find((ns) => ns.name === 'prod');

      // Create subgraphs as admin
      await createSubgraph(client, sourceSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);
      await createSubgraph(client, targetSubgraphName, DEFAULT_SUBGRAPH_URL_TWO, 'prod');

      // Switch to user with access only to default namespace
      authenticator.changeUserWithSuppliedContext({
        ...users[TestUser.adminAliceCompanyA],
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role: 'subgraph-admin' as OrganizationRole,
            namespaces: [defaultNamespace!.id],
          }),
        ),
      });

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName,
        targetSubgraphNamespace: 'prod',
      });

      expect(linkResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      await server.close();
    });

    test('Should use default namespace when source namespace is not provided', async () => {
      const { client, server } = await SetupTest({ dbname });

      await createNamespace(client, 'prod');
      const sourceSubgraphName = genID('source-subgraph');
      const targetSubgraphName = genID('target-subgraph');

      await createSubgraph(client, sourceSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);
      await createSubgraph(client, targetSubgraphName, DEFAULT_SUBGRAPH_URL_TWO, 'prod');

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        // sourceSubgraphNamespace not provided - should default to 'default'
        targetSubgraphName,
        targetSubgraphNamespace: 'prod',
      });

      expect(linkResponse.response?.code).toBe(EnumStatusCode.OK);

      await server.close();
    });
  });

  describe('UnlinkSubgraph', () => {
    test('Should successfully unlink a previously linked subgraph', async () => {
      const { client, server } = await SetupTest({ dbname });

      await createNamespace(client, 'prod');
      const sourceSubgraphName = genID('source-subgraph');
      const targetSubgraphName = genID('target-subgraph');

      // Create and link subgraphs
      await createSubgraph(client, sourceSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);
      await createSubgraph(client, targetSubgraphName, DEFAULT_SUBGRAPH_URL_TWO, 'prod');

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName,
        targetSubgraphNamespace: 'prod',
      });
      expect(linkResponse.response?.code).toBe(EnumStatusCode.OK);

      // Now unlink
      const unlinkResponse = await client.unlinkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
      });

      expect(unlinkResponse.response?.code).toBe(EnumStatusCode.OK);

      await server.close();
    });

    test('Should fail when source subgraph does not exist', async () => {
      const { client, server } = await SetupTest({ dbname });

      const unlinkResponse = await client.unlinkSubgraph({
        sourceSubgraphName: 'nonexistent-subgraph',
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
      });

      expect(unlinkResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      expect(unlinkResponse.response?.details).toBe('The subgraph "nonexistent-subgraph" was not found.');

      await server.close();
    });

    test('Should fail when source subgraph is not linked to any subgraph', async () => {
      const { client, server } = await SetupTest({ dbname });

      const sourceSubgraphName = genID('source-subgraph');
      await createSubgraph(client, sourceSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);

      const unlinkResponse = await client.unlinkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
      });

      expect(unlinkResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(unlinkResponse.response?.details).toBe(
        `The source subgraph "${sourceSubgraphName}" is not linked to any subgraph.`,
      );

      await server.close();
    });

    test('Should fail when user lacks write access to source subgraph', async () => {
      const { client, server, users, authenticator } = await SetupTest({
        dbname,
        enableMultiUsers: true,
        enabledFeatures: ['rbac'],
      });

      await createNamespace(client, 'prod');
      const sourceSubgraphName = genID('source-subgraph');
      const targetSubgraphName = genID('target-subgraph');

      // Create and link subgraphs as admin
      await createSubgraph(client, sourceSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);
      await createSubgraph(client, targetSubgraphName, DEFAULT_SUBGRAPH_URL_TWO, 'prod');

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName,
        targetSubgraphNamespace: 'prod',
      });
      expect(linkResponse.response?.code).toBe(EnumStatusCode.OK);

      // Switch to user without write permissions
      authenticator.changeUserWithSuppliedContext({
        ...users[TestUser.adminAliceCompanyA],
        rbac: createTestRBACEvaluator(createTestGroup({ role: 'subgraph-viewer' as OrganizationRole })),
      });

      const unlinkResponse = await client.unlinkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
      });

      expect(unlinkResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      await server.close();
    });

    test('Should use default namespace when source namespace is not provided', async () => {
      const { client, server } = await SetupTest({ dbname });

      await createNamespace(client, 'prod');
      const sourceSubgraphName = genID('source-subgraph');
      const targetSubgraphName = genID('target-subgraph');

      // Create and link subgraphs
      await createSubgraph(client, sourceSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);
      await createSubgraph(client, targetSubgraphName, DEFAULT_SUBGRAPH_URL_TWO, 'prod');

      const linkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName,
        targetSubgraphNamespace: 'prod',
      });
      expect(linkResponse.response?.code).toBe(EnumStatusCode.OK);

      // Unlink without providing namespace (should default to 'default')
      const unlinkResponse = await client.unlinkSubgraph({
        sourceSubgraphName,
        // sourceSubgraphNamespace not provided - should default to 'default'
      });

      expect(unlinkResponse.response?.code).toBe(EnumStatusCode.OK);

      await server.close();
    });

    test('Should allow relinking after unlinking', async () => {
      const { client, server } = await SetupTest({ dbname });

      await createNamespace(client, 'prod');
      await createNamespace(client, 'staging');
      const sourceSubgraphName = genID('source-subgraph');
      const firstTargetName = genID('first-target');
      const secondTargetName = genID('second-target');

      // Create all subgraphs
      await createSubgraph(client, sourceSubgraphName, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);
      await createSubgraph(client, firstTargetName, DEFAULT_SUBGRAPH_URL_TWO, 'prod');
      await createSubgraph(client, secondTargetName, 'http://localhost:4003', 'staging');

      // Link to first target
      const firstLinkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName: firstTargetName,
        targetSubgraphNamespace: 'prod',
      });
      expect(firstLinkResponse.response?.code).toBe(EnumStatusCode.OK);

      // Unlink
      const unlinkResponse = await client.unlinkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
      });
      expect(unlinkResponse.response?.code).toBe(EnumStatusCode.OK);

      // Link to second target should now work
      const secondLinkResponse = await client.linkSubgraph({
        sourceSubgraphName,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName: secondTargetName,
        targetSubgraphNamespace: 'staging',
      });
      expect(secondLinkResponse.response?.code).toBe(EnumStatusCode.OK);

      await server.close();
    });
  });

  describe('Integration Tests', () => {
    test('Should handle multiple link/unlink operations correctly', async () => {
      const { client, server } = await SetupTest({ dbname });

      await createNamespace(client, 'prod');
      await createNamespace(client, 'staging');

      const sourceSubgraph1 = genID('source-1');
      const sourceSubgraph2 = genID('source-2');
      const targetSubgraph1 = genID('target-1');
      const targetSubgraph2 = genID('target-2');

      // Create all subgraphs
      await createSubgraph(client, sourceSubgraph1, DEFAULT_SUBGRAPH_URL_ONE, DEFAULT_NAMESPACE);
      await createSubgraph(client, sourceSubgraph2, 'http://localhost:4004', DEFAULT_NAMESPACE);
      await createSubgraph(client, targetSubgraph1, DEFAULT_SUBGRAPH_URL_TWO, 'prod');
      await createSubgraph(client, targetSubgraph2, 'http://localhost:4003', 'staging');

      // Create multiple links
      const link1Response = await client.linkSubgraph({
        sourceSubgraphName: sourceSubgraph1,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName: targetSubgraph1,
        targetSubgraphNamespace: 'prod',
      });
      expect(link1Response.response?.code).toBe(EnumStatusCode.OK);

      const link2Response = await client.linkSubgraph({
        sourceSubgraphName: sourceSubgraph2,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName: targetSubgraph2,
        targetSubgraphNamespace: 'staging',
      });
      expect(link2Response.response?.code).toBe(EnumStatusCode.OK);

      // Unlink first one
      const unlink1Response = await client.unlinkSubgraph({
        sourceSubgraphName: sourceSubgraph1,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
      });
      expect(unlink1Response.response?.code).toBe(EnumStatusCode.OK);

      // Second link should still exist - attempting to link source2 again should fail
      const link2AgainResponse = await client.linkSubgraph({
        sourceSubgraphName: sourceSubgraph2,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
        targetSubgraphName: targetSubgraph1,
        targetSubgraphNamespace: 'prod',
      });
      expect(link2AgainResponse.response?.code).toBe(EnumStatusCode.ERR);
      expect(link2AgainResponse.response?.details).toBe(
        `The source subgraph "${sourceSubgraph2}" is already linked to the target subgraph "${targetSubgraph2}" in the namespace "staging". Unlink the existing link first.`,
      );

      // Unlink second one
      const unlink2Response = await client.unlinkSubgraph({
        sourceSubgraphName: sourceSubgraph2,
        sourceSubgraphNamespace: DEFAULT_NAMESPACE,
      });
      expect(unlink2Response.response?.code).toBe(EnumStatusCode.OK);

      await server.close();
    });
  });
});
